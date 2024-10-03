const Queue = require('./models/Queue')
const Room = require('./models/Room')
const Message = require('./models/Message')

const { Telegram } = require('telegraf')
const tg = new Telegram(process.env.BOT_TOKEN)

const { Markup } = require('telegraf')

const text = require('./config/lang/EN.json')

const pb = require('./config/pocketbase');
const fetch = require('node-fetch');
const FormData = require('form-data');

class MatchMaker {
    init() {
        setInterval(() => {
            Queue.find({}, (err, queues) => {
                if(err) {
                    console.log(err)
                } else {
                    if(queues.length == 2) {
                        let newParticipan = [];
                        queues.map(q => {
                            Queue.deleteOne({user_id: q.user_id}, (err) => {
                                if(err) {
                                    console.log(text.ERROR)
                                }
                            })
                            newParticipan.push(q.user_id)
                        })
                        this.createRoom(newParticipan)
                    }
                }
            }).limit(2)
        }, 2000);
    }

    createRoom(newParticipan) {
        let room = new Room({
            participans: newParticipan,
        });
        
        room.save(function(err, data) {
            if(err) return console.error(err)

            newParticipan.forEach(id => {
                tg.sendMessage(id, text.CREATE_ROOM.SUCCESS_1)
            });
            console.log(data)
        });
    }

    find(userID) {
        Queue.find({user_id: userID}, (err, res) => {
            if(err) {
                console.log(err)
            }else {
                if(res.length > 0) {
                    tg.sendMessage(userID, text.FIND.WARNING_1)
                }else {
                    Room.find({participans: userID}, (err, res) => {
                        if(err) {
                            console.log(err)
                        }else {
                            if(res.length > 0) {
                                tg.sendMessage(userID, text.FIND.WARNING_2)
                            }else {
                                tg.sendMessage(userID, text.FIND.LOADING)
                                let queue = new Queue({
                                    user_id: userID
                                });
                                
                                queue.save(function(err, data) {
                                    if(err) return console.error(err)
                                    console.log(data)
                                });
                            }
                        }
                    })
                }
            }
        }) 
    }

    next(userID) {
        Room.findOneAndDelete({participans: userID}, (err, doc) => {
            if(err) {
                console.log(err)
            }else {
                if(doc) {
                    let participans = doc.participans
                    participans.forEach(id => {
                        if(userID === id) {
                            tg.sendMessage(userID, text.NEXT.SUCCESS_1)
                            this.find(userID)
                        }else {
                            tg.sendMessage(id, text.NEXT.SUCCESS_2)
                        }
                    })
                }else {
                    tg.sendMessage(userID, text.NEXT.WARNING_1)
                }
            }
        }) 
    }

    stop(userID) {
        Room.findOneAndDelete({participans: userID}, (err, doc) => {
            if(err) {
                console.log(err)
            }else {
                if(doc) {
                    let participans = doc.participans
                    participans.forEach(id => {
                        if(userID === id) {
                            tg.sendMessage(userID, text.STOP.SUCCESS_1)
                        }else {
                            tg.sendMessage(id, text.STOP.SUCCESS_2)
                        }
                    })
                }else {
                    tg.sendMessage(userID, text.STOP.WARNING_1)
                }
            }
        })
    }

    exit(userID) {
        Queue.findOneAndDelete({user_id: userID}, (err, doc) => {
            if(err) {
                console.log(err)
            }else {
                if(doc != null) {
                    tg.sendMessage(userID, text.EXIT.SUCCESS_1)
                }else {
                    tg.sendMessage(userID, text.EXIT.WARNING_1)
                }
            }
        }) 
    }

    async connect(userID, [type, data]) {
        console.log(`Message received - Type: ${type}, User ID: ${userID}`);
        console.log('Message data:', data);

        try {
            const res = await Room.find({participans: userID});
            if (res.length > 0) {
                let participans = res[0].participans;
                let index = participans.indexOf(userID);
                let partnerID = participans[index == 1 ? 0 : 1];

                const saveMessage = async (messageData) => {
                    const message = new Message(messageData);
                    await message.save();
                };

                switch (type) {
                    case 'text':
                        const messageData = {
                            sender_id: userID.toString(),
                            receiver_id: partnerID.toString(),
                            type: 'text',
                            content: data.text
                        };

                        try {
                            // Save to PocketBase
                            await pb.collection('messages').create(messageData);
                            console.log('Text message saved to PocketBase successfully');

                            // Save to MongoDB
                            await saveMessage(messageData);

                            if (data.reply_to_message) {
                                await this.#sendReply(partnerID, userID, data.text, data, 'sendMessage');
                            } else {
                                await tg.sendMessage(partnerID, data.text);
                            }
                        } catch (err) {
                            console.error('Error saving or sending text message:', err);
                        }
                        break;
                    case 'sticker':
                        console.log(`Sticker: ${data.sticker.file_id}`);
                        saveMessage({
                            sender_id: userID,
                            receiver_id: partnerID,
                            file_id: data.sticker.file_id,
                            file_unique_id: data.sticker.file_unique_id,
                            type: 'sticker'
                        });

                        if (data.reply_to_message) {
                            this.#sendReply(partnerID, userID, data.sticker.file_id, data, 'sendSticker')
                                .catch(err => this.#errorWhenRoomActive(err, userID))
                        } else {
                            tg.sendSticker(partnerID, data.sticker.file_id)
                                .catch(err => this.#errorWhenRoomActive(err, userID))
                        }
                        break;
                    case 'voice':
                        console.log(`Voice message: ${data.voice.file_id}`);
                        saveMessage({
                            sender_id: userID,
                            receiver_id: partnerID,
                            file_id: data.voice.file_id,
                            file_unique_id: data.voice.file_unique_id,
                            type: 'voice'
                        });

                        if (data.reply_to_message) {
                            this.#sendReply(partnerID, userID, data.voice.file_id, data, 'sendVoice')
                                .catch(err => this.#errorWhenRoomActive(err, userID))
                        } else {
                            tg.sendVoice(partnerID, data.voice.file_id)
                                .catch(err => this.#errorWhenRoomActive(err, userID))
                        }
                        break;
                    case 'photo':
                        console.log(`Photo: ${data.file_id}`);
                        tg.getFileLink(data.file_id).then(async (fileLink) => {
                            console.log(`Photo link: ${fileLink}`);
                            const response = await fetch(fileLink);
                            const buffer = await response.buffer();

                            const formData = {
                                sender_id: userID.toString(),
                                receiver_id: partnerID.toString(),
                                type: 'photo',
                                file_id: data.file_id,
                                file_unique_id: data.file_unique_id,
                                content: fileLink,
                                file: new File([buffer], 'photo.jpg', { type: 'image/jpeg' })
                            };

                            try {
                                await pb.collection('messages').create(formData);
                                console.log('Photo saved to PocketBase successfully');
                            } catch (err) {
                                console.error('Error saving photo to PocketBase:', err);
                            }

                            saveMessage({
                                sender_id: userID,
                                receiver_id: partnerID,
                                file_id: data.file_id,
                                file_unique_id: data.file_unique_id,
                                type: 'photo',
                                content: fileLink
                            });

                            tg.sendPhoto(partnerID, data.file_id)
                                .catch(err => this.#errorWhenRoomActive(err, userID));
                        }).catch(err => console.error('Error getting file link:', err));
                        break;
                    case 'video':
                        console.log(`Video: ${data.file_id}`);
                        tg.getFileLink(data.file_id).then(async (fileLink) => {
                            console.log(`Video link: ${fileLink}`);
                            const response = await fetch(fileLink);
                            const buffer = await response.buffer();

                            const formData = {
                                sender_id: userID.toString(),
                                receiver_id: partnerID.toString(),
                                type: 'video',
                                file_id: data.file_id,
                                file_unique_id: data.file_unique_id,
                                content: fileLink,
                                file: new File([buffer], 'video.mp4', { type: 'video/mp4' })
                            };

                            try {
                                await pb.collection('messages').create(formData);
                                console.log('Video saved to PocketBase successfully');
                            } catch (err) {
                                console.error('Error saving video to PocketBase:', err);
                            }

                            saveMessage({
                                sender_id: userID,
                                receiver_id: partnerID,
                                file_id: data.file_id,
                                file_unique_id: data.file_unique_id,
                                type: 'video',
                                content: fileLink
                            });

                            tg.sendVideo(partnerID, data.file_id)
                                .catch(err => this.#errorWhenRoomActive(err, userID));
                        }).catch(err => console.error('Error getting file link:', err));
                        break;
                    default:
                        console.log(`Unsupported message type: ${type}`);
                        break;
                }
            } else {
                await tg.sendMessage(userID, text.CONNECT.WARNING_1);
            }
        } catch (err) {
            console.error('Error in connect method:', err);
        }
    }

    async currentActiveUser(userID) {
        let totalUserInRoom = await Room.countDocuments() * 2
        let totalUserInQueue = await Queue.countDocuments()
        let totalUser = totalUserInRoom + totalUserInQueue
        let textAactiveUser = text.ACTIVE_USER
            .replace('${totalUser}', totalUser)
            .replace('${totalUserInQueue}', totalUserInQueue)
            .replace('${totalUserInRoom}', totalUserInRoom)

        tg.sendMessage(userID, textAactiveUser)
    }

    #forceStop(userID) {
        Room.findOneAndDelete({participans: userID}, (err, doc) => {
            if(err) {
                console.log(err)
            }else {
                if(doc) {
                    let participans = doc.participans
                    participans.forEach(id => {
                        if(userID === id) {
                            tg.sendMessage(userID, text.STOP.SUCCESS_2)
                        }
                    })
                }
            }
        })
    }

    #errorWhenRoomActive({response, on}, userID) {
        console.log(response, on)
        switch (response.error_code) {
            case 403:
                this.#forceStop(userID)
                break;
            default:
                break;
        }
    }

    #sendReply(partnerID, userID, dataToSend, dataReply, type) {
        let {photo, video, message_id, from: {id} } = dataReply.reply_to_message

        let number = photo || video ? 2 : 1
        let replyToPlus =  { reply_to_message_id : message_id + number }
        let replyToMinus =  { reply_to_message_id : message_id - number }

        id == userID ? 
            tg[type](partnerID, dataToSend, replyToPlus) : 
            tg[type](partnerID, dataToSend, replyToMinus)
    }

}

module.exports = MatchMaker