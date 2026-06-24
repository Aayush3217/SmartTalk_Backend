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

const corsOptions = {
    origin:process.env.FRONTEND_URL,
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