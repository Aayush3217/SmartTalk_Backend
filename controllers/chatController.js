const { uploadFileToCloudinary } = require("../config/cloudinaryConfig");
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const response = require('../utils/responseHandler');
const User = require('../models/users');
const translateText = require('../services/translateService');
const redisService = require('../services/redisService');


exports.sendMessage = async(req, res) => {
    try {
        const {senderId, receiverId, conversationId, content, messageStatus} = req.body;
        const file = req.file;

        let conversation;
        if (conversationId) {
            conversation = await Conversation.findById(conversationId);
        } else if (receiverId) {
            const participants = [senderId, receiverId].sort();
            // check if 1-to-1 conversation already exists
            conversation = await Conversation.findOne({
                participants: participants,
                isGroup: { $ne: true }
            });

            // conversation not exists create new conversation
            if (!conversation) {
                conversation = new Conversation({
                    participants
                });
                await conversation.save();
            }
        } else {
            return response(res, 400, "Receiver ID or Conversation ID is required");
        }

        if (!conversation) {
            return response(res, 404, "Conversation not found");
        }

        let imageOrVideoUrl = null;
        let contentType = null;

        //handle file upload
        if(file){
            const uploadFile = await uploadFileToCloudinary(file);

            if(!uploadFile?.secure_url){
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
        }else if(content?.trim()){
            contentType = "text";
        }else{
            return response(res, 400, "Message content is required");
        }

        const message = new Message({
            conversation: conversation._id,
            sender: senderId,
            receiver: conversation.isGroup ? undefined : (receiverId || conversation.participants.find(p => p.toString() !== senderId)),
            content,
            contentType,
            imageOrVideoUrl: imageOrVideoUrl,
            messageStatus: conversation.isGroup ? 'send' : messageStatus
        });

        await message.save();
        await redisService.invalidateChatCache(conversation._id.toString());

        conversation.lastMessage = message._id;
        conversation.unreadCount += 1;
        await conversation.save();

        const populateMessage = await Message.findById(message._id)
            .populate("sender", "username profilePicture preferredLanguage")
            .populate("receiver", "username profilePicture preferredLanguage");

        // Return REST response immediately to the sender to avoid UI block/lag
        response(res, 201, "Message send successfully", populateMessage);

        // Run translation and Socket.IO emission in the background asynchronously
        (async () => {
            let needsSave = false;

            if (contentType === 'text' && content) {
                const senderUser = await User.findById(senderId);
                message.originalLanguage = senderUser ? (senderUser.preferredLanguage || 'English') : 'English';
                needsSave = true;

                if (!conversation.isGroup && receiverId) {
                    const receiverUser = await User.findById(receiverId);
                    if (senderUser && receiverUser) {
                        const sourceLang = senderUser.preferredLanguage || 'English';
                        const targetLang = receiverUser.preferredLanguage || 'English';

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
            }

            if (needsSave) {
                await message.save();
            }

            // Fetch the fully updated message with translations
            const finalMessage = await Message.findById(message._id)
                .populate("sender", "username profilePicture preferredLanguage")
                .populate("receiver", "username profilePicture preferredLanguage");

            // Emit socket event for realtime delivery
            if (req.io) {
                if (conversation.isGroup) {
                    req.io.to(conversation._id.toString()).emit("receive_message", finalMessage);
                } else {
                    const targetId = receiverId || conversation.participants.find(p => p.toString() !== senderId);
                    req.io.to(targetId.toString()).emit("receive_message", finalMessage);
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
                    req.io.to(message.sender.toString()).emit("message_read", updateMessage);
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
        if (req.io) {
            const conv = await Conversation.findById(message.conversation);
            if (conv && conv.isGroup) {
                req.io.to(message.conversation.toString()).emit("message_deleted", messageId);
            } else if (message.receiver) {
                req.io.to(message.receiver.toString()).emit("message_deleted", messageId);
            }
        }

        return response(res, 200, "Message delete successfully");
    }catch(error){
        console.error(error);
        return response(res, 500, "Internal server error");        
    }
}

// Create Group Chat Conversation
exports.createGroupConversation = async (req, res) => {
    try {
        const { groupName, participants: participantsRaw } = req.body;
        const file = req.file; // group avatar file
        const creatorId = req.user.userId;

        if (!groupName || !groupName.trim()) {
            return response(res, 400, "Group name is required");
        }

        let participants = [];
        if (typeof participantsRaw === 'string') {
            try {
                participants = JSON.parse(participantsRaw);
            } catch (err) {
                participants = participantsRaw.split(',').map(id => id.trim());
            }
        } else if (Array.isArray(participantsRaw)) {
            participants = participantsRaw;
        }

        // Add creator to participants if not already present
        if (!participants.includes(creatorId)) {
            participants.push(creatorId);
        }

        if (participants.length < 2) {
            return response(res, 400, "A group must have at least 2 participants");
        }

        let groupAvatar = null;
        if (file) {
            const uploadFile = await uploadFileToCloudinary(file);
            if (uploadFile?.secure_url) {
                groupAvatar = uploadFile.secure_url;
            }
        }

        const newGroup = new Conversation({
            participants,
            isGroup: true,
            groupName: groupName.trim(),
            groupAvatar: groupAvatar || 'https://cdn-icons-png.flaticon.com/512/166/166258.png', // default group icon
            groupAdmin: creatorId
        });

        await newGroup.save();

        const populatedGroup = await Conversation.findById(newGroup._id)
            .populate("participants", "username profilePicture isOnline lastSeen")
            .populate("groupAdmin", "username profilePicture");

        // Notify participants via socket that a group has been created
        if (req.io) {
            participants.forEach(participantId => {
                req.io.to(participantId).emit("group_created", populatedGroup);
            });
        }

        return response(res, 201, "Group conversation created successfully", populatedGroup);
    } catch (error) {
        console.error("createGroupConversation error:", error);
        return response(res, 500, error.message || "Internal server error");
    }
};

// Delete Group Conversation (authorized for group admin)
exports.deleteGroupConversation = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return response(res, 404, "Conversation not found");
        }

        if (!conversation.isGroup) {
            return response(res, 400, "This conversation is not a group chat");
        }

        // Verify that requester is the admin of the group
        if (conversation.groupAdmin.toString() !== userId) {
            return response(res, 403, "Not authorized to delete this group. Only the group admin can delete it.");
        }

        const participants = conversation.participants;

        // Delete all messages associated with the conversation
        await Message.deleteMany({ conversation: conversationId });

        // Delete the conversation itself
        await conversation.deleteOne();

        // Invalidate Redis chat cache
        await redisService.invalidateChatCache(conversationId);

        // Notify all participants in real time via socket
        if (req.io) {
            participants.forEach(participantId => {
                req.io.to(participantId.toString()).emit("group_deleted", { conversationId });
            });
        }

        return response(res, 200, "Group chat and all its messages deleted successfully");
    } catch (error) {
        console.error("deleteGroupConversation error:", error);
        return response(res, 500, error.message || "Internal server error");
    }
};