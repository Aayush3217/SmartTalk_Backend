const mongoose = require('mongoose');

const connectdb = async() => {
    try{
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Mongo database connected succesfully")
    }catch(error){
        console.log(`Error connecting database`, error.message);
        process.exit(1);
    }
}

module.exports = connectdb;