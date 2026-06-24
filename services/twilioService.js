const twilio = require('twilio')

//Twilio creaditials from env
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const serviceSid = process.env.TWILIO_SERVICE_SID;

const client = twilio(accountSid, authToken);

//send otp to phone number
const sendOtpToPhoneNumber = async(phoneNumber) => {
    try{
        console.log('sending otp to this number', phoneNumber);
        if(!phoneNumber){
            throw new Error('phone number is required');
        }
        const response = await client.verify.v2.services(serviceSid).verifications.create({
            to:phoneNumber,
            channel:'sms'
        });
    }catch(error){
        console.log(error);
        throw new Error('Failed to send otp');
    }
}

//verify otp
const verifyOtp = async (phoneNumber, otp) => {
    try {

        console.log("this is my otp", otp);
        console.log("this number", phoneNumber);

        const response =
            await client.verify.v2
                .services(process.env.TWILIO_SERVICE_SID)
                .verificationChecks
                .create({
                    to: phoneNumber,
                    code: otp
                });

        return response;

    } catch (error) {

        console.log(error);

        throw new Error("otp verification failed");
    }
};

module.exports = {
    sendOtpToPhoneNumber,
    verifyOtp
}

