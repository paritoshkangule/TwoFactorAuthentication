const express = require('express');
const app = express();
const mysql = require('mysql');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const cors = require('cors');
app.use(cors());

// Define common headers for CORS support
const commonHeaders = {
    "Access-Control-Allow-Origin": "*", // Required for CORS support to work
    "Access-Control-Allow-Credentials": true // Required for cookies, authorization headers with HTTPS
};

//mysql configuration
const db = mysql.createConnection({
    host: "database-1.cxw7hgq3ybtu.ap-south-1.rds.amazonaws.com", 
    port: 3306,
    user: "admin",
    password: "admin123",
    database: "db_tfa"
});

//connecting to mysql
db.connect((err) => {
    if (err) {
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
        if (err) {
            throw err;
        }
        console.log('users table created or exists');
    });

//user
const userData = {
    username: 'abc',
    password: '123',
    secret: speakeasy.generateSecret().base32
};
console.log(userData);

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

// Function to retrieve users
const getUsers = () => {
    return new Promise((resolve, reject) => {
        // Perform a database query to fetch users
        db.query("SELECT ID, username, password, secret FROM users", (err, result) => {
            if (err) {
                console.error('Error getting users: ' + err.stack);
                reject({ statusCode: 500, body: JSON.stringify({ message: "Internal Server Error" }) });
            } else {
                resolve({ statusCode: 200, headers: commonHeaders, body: JSON.stringify(result) });
            }
        });
    });
};


// Function to retrieve a user by username
const getUserByUsername = (username) => {
    return new Promise((resolve, reject) => {
        // Perform a database query to fetch user by username
        db.query("SELECT * FROM users WHERE username = ?", username, (err, result) => {
            if (err) {
                console.error('Error getting user by username: ' + err.stack);
                reject({ statusCode: 500, body: JSON.stringify({ message: "Internal Server Error" }) });
            } else {
                if (result.length > 0) {
                    resolve({ statusCode: 200, headers: commonHeaders, body: JSON.stringify(result[0]) });
                } else {
                    resolve({ statusCode: 404, headers: commonHeaders, body: JSON.stringify({ message: 'User not found' }) });
                }
            }
        });
    });
};


//Function to login and generate qrCode
async function loginUser(username, password) {
    return new Promise((resolve, reject) => {
        // Perform a database query to fetch user by username and password
        db.query("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], async (err, result) => {
            if (err) {
                console.error('Error during login: ' + err.stack);
                reject({ statusCode: 500, headers: commonHeaders, body: JSON.stringify({ message: "Internal Server Error" }) });
            }
            if (result.length === 0) {
                resolve({ statusCode: 401, headers: commonHeaders, body: JSON.stringify({ message: 'Invalid Credentials' }) });
            } else {
                const user = result[0];
                try {
                    const imageUrl = await generateQRCode(user.secret);
                    resolve({ statusCode: 200, headers: commonHeaders, body: JSON.stringify({ qrCodeUrl: imageUrl }) });
                } catch (error) {
                    console.error('Error generating QR code: ' + error.stack);
                    reject({ statusCode: 500, headers: commonHeaders, body: JSON.stringify({ message: "Error while generating QR code" }) });
                }
            }
        });
    });
}

// QR Code generation
async function generateQRCode(secret) {
    return new Promise((resolve, reject) => {
        qrcode.toDataURL(secret, (err, imageUrl) => {
            if (err) {
                reject(err);
            } else {
                resolve(imageUrl);
            }
        });
    });
}


//Validate the qrCode using authenticator
async function validateOTP(username, otp) {
    return new Promise((resolve, reject) => {
        // Fetch user from the database based on the provided username
        db.query("SELECT * FROM users WHERE username = ?", username, (err, result) => {
            if (err) {
                console.error('Error fetching user from database: ' + err.stack);
                reject({ statusCode: 500, headers: commonHeaders, body: JSON.stringify({ message: "Internal Server Error" }) });
            } else {
                if (result.length === 0) {
                    resolve({ statusCode: 404, headers: commonHeaders, body: JSON.stringify({ message: 'User not found' }) });
                } else {
                    const user = result[0];
                    const validate = speakeasy.totp.verify({
                        secret: user.secret,
                        encoding: 'base32',
                        token: otp
                    });
                    if (validate) {
                        resolve({ statusCode: 200, headers: commonHeaders, body: JSON.stringify({ message: 'Authentication Successful' }) });
                    } else {
                        resolve({ statusCode: 401, headers: commonHeaders, body: JSON.stringify({ message: 'Invalid OTP' }) });
                    }
                }
            }
        });
    });
}

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event));

    try {
        // Extract necessary information from the event
        const { httpMethod, path, body } = event;

        // Handle different HTTP methods and paths
        if (httpMethod === 'GET' && path === '/api/users') {
            // Call a function to retrieve users from the database
            const users = await getUsers();
            return {
                statusCode: users.statusCode,
                headers: users.headers,
                body: users.body
            };
        } else if (httpMethod === 'GET' && path.startsWith('/api/users/:username')) {
            // Extract username from the path and call function to retrieve user by username from the database
            const username = path.substring('/api/users/'.length);
            const user = await getUserByUsername(username);
            return {
                statusCode: user.statusCode,
                headers: user.headers,
                body: user.body
            };
        } else if (httpMethod === 'POST' && path === '/api/login') {
            // Parse the body and call a function to perform login authentication using database
            const { username, password } = JSON.parse(body);
            const loginResult = await loginUser(username, password);
            return {
                statusCode: loginResult.statusCode,
                headers: loginResult.headers,
                body: loginResult.body
            };
        } else if (httpMethod === 'POST' && path === '/api/validate') {
            // Parse the body and call a function to validate OTP using database
            const { username, otp } = JSON.parse(body);
            const validationResult = await validateOTP(username, otp);
            return {
                statusCode: validationResult.statusCode,
                headers: validationResult.headers,
                body: validationResult.body
            };
        } else {
            // Handle invalid requests
            return {
                statusCode: 404,
                headers: commonHeaders,
                body: JSON.stringify({ message: 'Not Found' })
            };
        }
    } catch (error) {
        // Handle errors
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: commonHeaders,
            body: JSON.stringify({ message: 'Internal Server Error' })
        };
    }
};