const { uploadFileToCloudinary } = require("../config/cloudinaryConfig");
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const response = require('../utils/responseHandler');
const User = require('../models/users');
const translateText = require('../services/translateService');
const redisService = require('../services/redisService');


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
        await redisService.invalidateChatCache(conversation?._id.toString());

        if(message?.content){ // if content is coming 
            conversation.lastMessage = message?._id;
        }
        conversation.unreadCount+=1;
        await conversation.save();


        const populateMessage = await Message.findById(message?._id)
            .populate("sender", "username profilePicture preferredLanguage")
            .populate("receiver", "username profilePicture preferredLanguage");

        // Return REST response immediately to the sender to avoid UI block/lag
        response(res, 201, "Message send successfully", populateMessage);

        // Run translation and Socket.IO emission in the background asynchronously
        (async () => {
            let needsSave = false;

            if (contentType === 'text' && content) {
                const senderUser = await User.findById(senderId);
                const receiverUser = await User.findById(receiverId);

                if (senderUser && receiverUser) {
                    const sourceLang = senderUser.preferredLanguage || 'English';
                    const targetLang = receiverUser.preferredLanguage || 'English';

                    message.originalLanguage = sourceLang;
                    needsSave = true;

                    if (sourceLang.toLowerCase() !== targetLang.toLowerCase()) {
                        try {
                            const translatedText = await translateText(content, sourceLang, targetLang);
                            if (translatedText && translatedText !== content) {
                                message.translations.push({
                                    language: targetLang,
                                    content: translatedText
                                });
                            }
                        } catch (err) {
                            console.error("Background translation failed:", err.message);
                        }
                    }
                }
            }

            if (needsSave) {
                await message.save();
            }

            // Fetch the fully updated message with translations
            const finalMessage = await Message.findById(message._id)
                .populate("sender", "username profilePicture preferredLanguage")
                .populate("receiver", "username profilePicture preferredLanguage");

            // Emit socket event for realtime delivery
            if (req.io && req.socketUserMap) {
                const receiverSocketId = await req.socketUserMap.getSocketId(receiverId);
                if (receiverSocketId) {
                    req.io.to(receiverSocketId).emit("receive_message", finalMessage);
                    message.messageStatus = "delivered";
                    await message.save();
                }
            }
        })().catch(err => console.error("Background message dispatch error:", err));
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

        // Try to fetch from Redis cache first
        let message = await redisService.getCachedMessages(conversationId);

        if (!message) {
            message = await Message.find({conversation:conversationId})
            .populate("sender", "username profilePicture")
            .populate("receiver", "username profilePicture")
            .sort("createdAt");

            // Cache the latest 50 messages
            await redisService.setCachedMessages(conversationId, message);
        }

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
                const senderSocketId = await req.socketUserMap.getSocketId(message.sender.toString());
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

        // Invalidate cache for the conversation
        const uniqueConvIds = [...new Set(messages.map(m => m.conversation.toString()))];
        for (const convId of uniqueConvIds) {
            await redisService.invalidateChatCache(convId);
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
        await redisService.invalidateChatCache(message.conversation.toString());

        // Emit socket event
        if(req.io && req.socketUserMap){
            const receiverSocketId = await req.socketUserMap.getSocketId(message.receiver.toString());
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