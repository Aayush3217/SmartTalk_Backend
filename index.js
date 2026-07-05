const express = require('express')
const cookieParser = require('cookie-parser')
const cors = require('cors')
const dotenv = require('dotenv');
const connectdb = require('./config/dbConnect');
const bodyParser = require('body-parser')
const authRoute = require('./routes/authRoute')
const chatRoute = require('./routes/chatRoute');
const statusRoute = require('./routes/statusRoute');
const http = require('http');
const initializeSocket = require('./services/socketService');
 

dotenv.config();

const PORT = process.env.PORT;
const app = express();

const allowedOrigins = [
    process.env.FRONTEND_URL,
    'https://smart-talk-frontend.vercel.app'
].filter(Boolean).map(origin => origin.replace(/\/$/, ''));

const corsOptions = {
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
    credentials: true
}

app.use(cors(corsOptions));

//MiddleWare
app.use(express.json()) //parse body data
app.use(cookieParser()) //parse token on every request
app.use(bodyParser.urlencoded({extended:true}));


//database connection
connectdb();


//create server 
const server = http.createServer(app);

const io = initializeSocket(server);

//apply socket middleware before routes
app.use((req, res, next) => {
    req.io = io;
    req.socketUserMap = io.sockets.socketUserMap;
    next();
})


//Routes
app.use('/api/auth', authRoute);
app.use('/api/chats', chatRoute);
app.use('/api/status', statusRoute)

server.listen(PORT, () => {
    console.log(`Server running on this port: ${PORT}`)
})