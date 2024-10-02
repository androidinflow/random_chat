const mongoose = require("mongoose")

const messageSchema = new mongoose.Schema({
    sender_id: { type: Number, required: true },
    receiver_id: { type: Number, required: true },
    content: { type: String },
    type: { type: String, required: true },
    file_id: { type: String },
    file_unique_id: { type: String },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Message", messageSchema)
