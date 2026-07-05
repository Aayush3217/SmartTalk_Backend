const { uploadFileToCloudinary } = require("../config/cloudinaryConfig");
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const response = require('../utils/responseHandler');


exports.sendMessage = async(req, res) => {
    try {
        const {senderId, receiverId, content, messageStatus} = req.body;
        const file = req.file;

        const participants = [senderId,receiverId].sort();
        //check if conversation already exists
        let conversation = await Conversation.findOne({
            participants: participants
        });

        //conversation not exists create new conversation
        if(!conversation){
            conversation = new Conversation({
                participants
            });
            await conversation.save();
        }

        let imageOrVideoUrl = null;
        let contentType = null;

        //handle file upload
        if(file){
            const uploadFile = await uploadFileToCloudinary(file);

            if(!uploadFile?.secure_url){ // (?)-> means check karna secure_url aa raha ha y nahi
                return response(res, 400, "Failed to upload media");
            }
            imageOrVideoUrl = uploadFile?.secure_url;

            if(file.mimetype.startsWith("image")){
                contentType = "image";
            }else if(file.mimetype.startsWith("video")){
                contentType = "video";
            }else{
                return response(res, 400, "Unsupported file type");
            }
        }else if(content?.trim()){   // trim -> content ke andar kuch string to ha na
            contentType = "text";
        }else{
            return response(res, 400, "Message content is required");
        }

        const message = new Message({
            conversation: conversation?._id,
            sender: senderId,
            receiver: receiverId,
            content,
            contentType,
            imageOrVideoUrl: imageOrVideoUrl,
            messageStatus
        });

        await message.save();

        if(message?.content){ // if content is coming 
            conversation.lastMessage = message?._id;
        }
        conversation.unreadCount+=1;
        await conversation.save();


        const populateMessage = await Message.findById(message?._id)
        .populate("sender", "username profilePicture")
        .populate("receiver", "username profilePicture")

        // Emit socket event for realtime
        if(req.io && req.socketUserMap){
            const receiverSocketId = req.socketUserMap.get(receiverId);
            if(receiverSocketId){
                req.io.to(receiverSocketId).emit("receive_message", populateMessage);
                message.messageStatus = "delivered";
                await message.save();
            }
        }


        return response(res, 201, "Message send successfully", populateMessage);
    } catch (error) {
        console.error("sendMessage error:", error);
        return response(res, 500, error.message || "Internal server error");
    }
};

//get all conversation
exports.getConversation = async(req, res) => {
    const user = req.user.userId;
    try {
        let conversation = await Conversation.find({
            participants: user,
        }).populate("participants", "username profilePicture isOnline lastSeen")
        .populate({
            path: "lastMessage",
            populate:{
                path: "sender receiver",
                select: "username profilePicture"
            }
        }).sort({updatedAt: -1})

        return response(res, 201, 'Conversation get sucessfully', conversation)
    } catch (error) {
        console.error(error);
        return response(res, 500, "Internal server error");
    }
};

//get messages of specefic conversation
exports.getMessages = async(req, res) => {
    const {conversationId} = req.params;
    const userId = req.user.userId;
    try {
        const conversation = await Conversation.findById(conversationId);
        if(!conversation){
            return response(res, 404, "Conversation not found");
        }

        if(!conversation.participants.includes(userId)){
            return response(res, 403, "Not authorized to view this conversation")
        }

        const message = await Message.find({conversation:conversationId})
        .populate("sender", "username profilePicture")
        .populate("receiver", "username profilePicture")
        .sort("createdAt");

        await Message.updateMany(
            {
                conversation:conversationId,
                receiver:userId,
                messageStatus:{$in: ["send", "delivered"]},
            },
            {$set: {messageStatus: "read"}},
        );

        conversation.unreadCount = 0;
        await conversation.save();

        return response(res, 200, "Message retrived", message);
    } catch (error) {
        console.error(error);
        return response(res, 500, "Internal server error");        
    }
}

// Marks as read
exports.markAsRead = async(req, res) => {
    const {messageIds} = req.body;
    const userId = req.user.userId;

    try {
        //get relevant message to determine senders
        let messages = await Message.find({
            _id:{$in : messageIds},
            receiver: userId,
        })

        await Message.updateMany(
            {_id: {$in: messageIds}, receiver: userId},
            {$set: {messageStatus:"read"}}
        );

        // notify to original sender
        if(req.io && req.socketUserMap){
            for(const message of messages){
                const senderSocketId = req.socketUserMap.get(message.sender.toString());
                if(senderSocketId){
                    const updateMessage = {
                        _id: message._id,
                        messageStatus: "read",
                    };
                    req.io.to(senderSocketId).emit("message_read", updateMessage);
                    await message.save();
                }
            }
        }                  

        return response(res, 200, "Message marked as read", messages);
    } catch (error) {
        console.error(error);
        return response(res, 500, "Internal server error");          
    }
}

// Message delete
exports.deleteMessage = async(req, res) => {
    const {messageId} = req.params;
    const userId = req.user.userId;
    try{
        const message =  await Message.findById(messageId);
        if(!message){
            return response(res, 404, "Message not found")
        };

        if(message.sender.toString() !== userId){
            return response(res, 403, "Not authorized to delete this message")
        }

        await message.deleteOne();

        // Emit socket event
        if(req.io && req.socketUserMap){
            const receiverSocketId = req.socketUserMap.get(message.receiver.toString());
            if(receiverSocketId){
                req.io.to(receiverSocketId).emit("message_deleted", messageId);
            }
        }

        return response(res, 200, "Message delete successfully");
    }catch(error){
        console.error(error);
        return response(res, 500, "Internal server error");        
    }
}