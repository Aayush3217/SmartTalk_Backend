const { Server } = require('socket.io');
const User = require('../models/users');
const Message = require('../models/Message');
const redisService = require('./redisService');

//Map to track typing status -> userId -> [converstion]: boolean
const typingUsers = new Map();

const initializeSocket = (server) => {
    const allowedOrigins = [
        process.env.FRONTEND_URL,
        'https://smart-talk-frontend.vercel.app'
    ].filter(Boolean).map(origin => origin.replace(/\/$/, ''));

    const io = new Server(server, {
        cors: {
            origin: (origin, callback) => {
                if (!origin) return callback(null, true);
                const normalizedOrigin = origin.replace(/\/$/, '');
                const isLocalhost = normalizedOrigin.startsWith('http://localhost:') || normalizedOrigin.startsWith('http://127.0.0.1:');
                if (allowedOrigins.includes(normalizedOrigin) || isLocalhost) {
                    callback(null, true);
                } else {
                    callback(new Error('Not allowed by CORS'));
                }
            },
            credentials: true, // client side sa jab bhejta ha [cookies ka andar token ha ya nahi]
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        },
        pingTimeout: 60000, //Disconnect inactive users or sockets after 60 sec
    });


    // when a new socket connection is established
    io.on("connection", (socket) => {
        console.log(`User connected: ${socket.id}`)
        let userId = null;

        //receive a message to the client
        //hanlde user connection and mark them online in db
        socket.on("user_connected", async (connectingUserId) => {
            try {
                userId = connectingUserId;
                await redisService.setUserOnline(userId, socket.id);
                socket.join(userId); // join a personal room for direct emits

                //update user status in db
                await User.findByIdAndUpdate(userId, {
                    isOnline: true,
                    lastSeen: new Date(),
                });

                //send a message to the client
                //notify all users that this user is now online
                io.emit("user_status", { userId, isOnline: true });
            } catch (error) {
                console.error("Error handling user connection", error);
            }
        });

        //Return online status of requested user
        socket.on("get_user_status", async (requestedUserId, callback) => {
            const isOnline = await redisService.isUserOnline(requestedUserId);
            callback({
                userId: requestedUserId,
                isOnline,
                lastSeen: isOnline ? new Date() : null,
            })
        });

        // forward message to receiver if online
        socket.on("send_message", async (message) => {
            try {
                const receiverSocketId = await redisService.getSocketId(message.receiver?._id);
                // Instantly sends message to receiver's room.
                if (receiverSocketId) {
                    io.to(message.receiver?._id).emit("receive_message", message);
                }
            } catch (error) {
                console.error("Error sending message", error)
                socket.emit("message_error", { error: "Failed to send message" })
            }
        });

        //update message as read and notify sender
        socket.on("message_read", async ({ messageIds, senderId }) => {
            try {
                await Message.updateMany(
                    { _id: { $in: messageIds } },
                    { $set: { messageStatus: "read" } }
                )

                const senderSocketId = await redisService.getSocketId(senderId);
                if (senderSocketId) {
                    messageIds.forEach((messageId) => {
                        io.to(senderId).emit("message_status_update", {
                            messageId,
                            messageStatus: "read"
                        })
                    })
                }
            } catch (error) {
                console.error("Error updating message read status", error);
            }
        });

        // handle typing start event and auto-stop after 3s
        socket.on("typing_start", ({ conversationId, receiverId }) => {
            if (!userId || !conversationId || !receiverId) return;

            if (!typingUsers.has(userId)) typingUsers.set(userId, {});

            const userTyping = typingUsers.get(userId);

            userTyping[conversationId] = true;

            //clear any exiting timeout
            if (userTyping[`${conversationId}_timeout`]) {
                clearTimeout(userTyping[`${conversationId}_timeout`])
            }

            //auto-stop after 3s
            userTyping[`${conversationId}_timeout`] = setTimeout(() => {
                userTyping[conversationId] = false;
                socket.to(receiverId).emit("user_typing", {
                    userId,
                    conversationId,
                    isTyping: false
                })
            }, 3000)

            //Notify receiver
            socket.to(receiverId).emit("user_typing", {
                userId,
                conversationId,
                isTyping: true
            })
        });

        socket.on("typing_stop", ({ conversationId, receiverId }) => {
            if (!userId || !conversationId || !receiverId) return;

            if (typingUsers.has(userId)) {
                const userTyping = typingUsers.get(userId);
                userTyping[conversationId] = false;

                if (userTyping[`${conversationId}_timeout`]) {
                    clearTimeout(userTyping[`${conversationId}_timeout`])
                    delete userTyping[`${conversationId}_timeout`]
                }
            };

            socket.to(receiverId).emit("user_typing", {
                userId,
                conversationId,
                isTyping: false
            })
        });

        // Add or update reaction on message 
        socket.on("add_reaction", async ({ messageId, emoji, userId, recationUserId }) => {
            try {
                const message = await Message.findById(messageId);
                if (!message) return;

                const exitingIndex = message.reactions.findIndex(
                    (r) => r.user.toString() === reactionUserId
                )

                if (exitingIndex > -1) {
                    const exiting = message.reactions[exitingIndex];
                    if (exiting.emoji === emoji) {
                        // remove same raection
                        message.reactions.splice(exitingIndex, 1);
                    } else {
                        // change emoji
                        message.reactions[exitingIndex].emoji = emoji;
                    }
                } else {
                    // add new recations
                    message.reactions.push({ user: reactionUserId, emoji });
                }

                await message.save();

                const populateMessage = await Message.findOne(message?._id)
                    .populate("sender", "username profilePicture")
                    .populate("receiver", "username profilePicture")
                    .populate("reactions.user", "username")

                const reactionUpdated = {
                    messageId,
                    reactions: populateMessage.reactions
                }

                const senderSocket = await redisService.getSocketId(populateMessage.sender._id.toString());
                const receiverSocket = await redisService.getSocketId(populateMessage.receiver?._id.toString());

                if (senderSocket) io.to(populateMessage.sender._id.toString()).emit("reaction_update", reactionUpdated);
                if (receiverSocket) io.to(populateMessage.receiver?._id.toString()).emit("reaction_update", reactionUpdated);

            } catch (error) {
                console.error("Error handling reactions", error);
            }
        });

        // handle disconnection and mark user offline
        const handleDisconnected = async () => {
            if (!userId) return;
            try {
                // Prevent race condition: check if this disconnecting socket is still the active one
                const currentSocketId = await redisService.getSocketId(userId);
                if (currentSocketId === socket.id) {
                    await redisService.removeUserOnline(userId);

                    await User.findByIdAndUpdate(userId, {
                        isOnline: false,
                        lastSeen: new Date(),
                    });

                    io.emit("user_status", { userId, isOnline: false, lastSeen: new Date() });
                    console.log(`user ${userId} disconnected`);
                } else {
                    console.log(`Socket mismatch for user ${userId}: current is ${currentSocketId}, disconnecting is ${socket.id}. Skipping offline status update.`);
                }

                //clear all typing timeouts
                if (typingUsers.has(userId)) {
                    const userTyping = typingUsers.get(userId);
                    Object.keys(userTyping).forEach((key) => {
                        if (key.endsWith('_timeout')) clearTimeout(userTyping[key])
                    })

                    typingUsers.delete(userId);
                }

                socket.leave(userId);
            } catch (error) {
                console.error("Error handling disconnection", error);
            }
        }

        // disconnect event
        socket.on("disconnect", handleDisconnected);
    });
    //attach the online user map helper wrapper to the socket server for external user
    io.socketUserMap = redisService;

    return io;
}

module.exports = initializeSocket;