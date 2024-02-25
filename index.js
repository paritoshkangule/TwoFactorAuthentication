const express = require('express');
const app = express();

const mysql = require('mysql');
const cors = require('cors');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

//from any origin
app.use(cors());
// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

//mysql configuration
const db = mysql.createConnection({
    host: "database-1.cxw7hgq3ybtu.ap-south-1.rds.amazonaws.com",
    port: "3306",
    user: "admin",
    password: "admin123",
    database: "db_tfa" 
});

//connecting to mysql
db.connect((err) => {
    if(err){
        throw err;
    }
    console.log('MySQL connected...');
});

//creating users table if they are not exists
db.query(`CREATE TABLE IF NOT EXISTS users(
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    secret VARCHAR(255) NOT NULL 
)`, 
(err, result) => {
    if(err){
        throw err;
    }
    console.log('users table created or exists');
});

//user 
const userData = {
    username: 'xyz',
    password: '123',
    secret: speakeasy.generateSecret().base32
}

// Check if the username already exists
db.query('SELECT * FROM users WHERE username = ?', userData.username, (err, result) => {
    if (err) {
        throw err;
    }

    // If the username already exists, handle the error
    if (result.length > 0) {
        console.log('Username already exists');
    }
    // Handle the error gracefully, perhaps by informing the user to choose a different username
    // Insert user data into the users table if the username doesn't exist
    else {
        db.query('INSERT INTO users SET ?', userData, 
        (err, result) => {
            if (err) {
                throw err;
            }
            console.log('User data inserted successfully');
        });
    }
});


//get all users
app.get("/api/users", (req,res) => {
    db.query("SELECT ID, username, password, secret FROM users", (err, result) => {
        if(err){
            throw err;
        }
        res.json(result);
    });
});

//get user by username
app.get("/api/users/:username", (req, res) =>{
    const username = req.params.username;
    db.query("SELECT * FROM users WHERE username = ?", username, 
    (err, result) => {
        if(err){
            throw err;
        }
        if(result.length === 0){
            return res.status(404).json({message: 'user not found'});
        }
        res.json(result[0]);
    });
});

//login and generate qr code
app.post("/api/login", (req, res) => {
    const {username, password} = req.body;
    db.query("SELECT * FROM users WHERE username = ? AND password =?", [username, password], 
    (err, result) => {
        if(err){
            throw err;
        }
        if(result.length === 0){
            return res.status(401).json({message:'Invalid credentials...'})
        }
        const user = result[0];
        qrcode.toDataURL(user.secret, (err, imageUrl) => {
            if(err){
                return res.status(500).json({message:"error while generating QR code"});
            }
            res.json({
                qrCodeUrl: imageUrl
            });
        });
    });
});

//validate using Google Authenticator
app.post("/api/validate", (req, res) => {
    const{username, otp} = req.body;
    db.query("SELECT * FROM users WHERE username = ?", username, (err, result) => {
        if(err){
            throw err;
        }
        if(result.length === 0){
          return res.status(404).json({message:"user not found"});
        }
        const user = result[0];
        const validate =speakeasy.totp.verify({
            secret: user.secret,
            encoding: 'base32',
            token: otp
        });
        if(validate){
            return res.json({
                message:"Authentication Successful..."
            });
        }
    });
});

module.exports = app;