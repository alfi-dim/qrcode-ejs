const express = require('express');
const QRCode = require('qrcode');
const mongoose = require('mongoose');
const session = require('express-session');

const app = express();
app.use(express.json());
app.set('view engine', 'ejs');
app.use(session({
  secret: 'your_secret_key', // Change this to a secure key
  resave: false,
  saveUninitialized: true,
}));
app.use(express.urlencoded({ extended: false }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODBURL);

// QR Code Schema Model
const QRCodeModel = mongoose.model('QRCode', {
  codeId: String,
  generatedBy: String,
  generatedAt: Date,
  scannedBy: { type: String, default: null },
  scannedAt: { type: Date, default: null },
  points: Number,
});

// User Schema Model
const User = mongoose.model('User', {
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' },
  points: { type: Number, default: 0 }, // Add points field
});

// Serve static files (CSS, images, etc.)
app.use(express.static('public'));

// Route to render the QR code generator page
app.get('/generate', (req, res) => {
  res.render('generate');  // Renders the form to generate a QR code
});

// Function to generate a random QR Code ID of a specific length
function generateQRCodeId(length) {
  const characters = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefghjkmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Route to render the signup page
app.get('/signup', (req, res) => {
  res.render('signup'); // Create this view
});

// Route to handle signup
app.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    return res.status(400).send('User already exists');
  }

  const newUser = new User({ email, password, role: 'user' });
  await newUser.save();
  res.redirect('/login'); // Redirect to login after signup
});

// Route to render the login page
app.get('/login', (req, res) => {
  res.render('login'); // Create this view
});

// Route to handle login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user || !user.password === password) {
    return res.status(401).send('Invalid email or password');
  }

  // Store user information in session
  req.session.userId = user._id;
  req.session.role = user.role; // Store user role as well
  if (user.role === 'admin') {
    return res.redirect('/generate'); // Redirect to QR code generator for admin
  }
  res.redirect('/scan'); // Redirect to QR scanner for user
});

// Middleware to check if user is logged in
const ensureAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/login'); // Redirect to login if not authenticated
};

// Route to handle QR code generation
app.post('/generate', ensureAuthenticated, async (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).send('Only admins can generate QR codes');
  }

  const qrCodeData = {
    codeId: generateQRCodeId(6), // Get last 6 characters for ID
    generatedBy: req.session.userId,
    generatedAt: new Date(),
    points: Math.floor(Math.random() * 91) + 10 // Random points between 10 and 100
  };

  // Save QR code data to the database
  const newQRCode = new QRCodeModel(qrCodeData);
  await newQRCode.save();

  // Generate the QR code image as a Data URL
  QRCode.toDataURL(qrCodeData.codeId, (err, url) => {
    if (err) {
      console.log('Error generating QR code', err);
      return res.status(500).send('Error generating QR code');
    }
    res.render('generatedQR', { qrCodeUrl: url, qrCodeData });
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.redirect('/'); // Redirect on error
    }
    res.clearCookie('connect.sid'); // Clear the session cookie
    res.redirect('/login'); // Redirect to login after logout
  });
});


// Route to render the QR scanner page
app.get('/scan', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  // Fetch the user data from the database
  User.findById(req.session.userId).then(user => {
    res.render('scanner', { user }); // Pass user data to the view
  }).catch(err => {
    console.error(err);
    res.redirect('/login');
  });
});


// Route to handle scanned QR code
// Route to handle scanned QR code
app.post('/scan', async (req, res) => {
  const scannedCodeId = req.body.qrCodeId;
  const userId = req.session.userId; // Get user ID from session

  // Check if the QR code exists
  const qrCode = await QRCodeModel.findOne({ codeId: scannedCodeId });

  if (!qrCode) {
    return res.status(404).send('QR Code not found');
  }

  // Check if already scanned
  if (qrCode.scannedBy) {
    return res.status(400).send('QR Code already scanned');
  }

  // Update QR code to mark as scanned
  qrCode.scannedBy = userId;
  qrCode.scannedAt = new Date();
  await qrCode.save();

  // Find user and update points
  const user = await User.findById(userId);
  const points = qrCode?.points || 10; // Default points to 10 if not set
  user.points += points; // Add points from the QR code
  await user.save();

  // Respond with user information
  res.json({ message: 'QR Code scanned successfully!', pointsEarned: points, currentPoints: user.points });
});



// Route to view all generated QR codes
app.get('/view-qr-codes', async (req, res) => {
  try {
    // Retrieve all QR codes and populate the scannedBy field with the user's email
    const qrCodes = await QRCodeModel.find().lean(); // Get all QR codes

    // Populate the scannedBy field with user emails based on user ID
    const populatedQrCodes = await Promise.all(qrCodes.map(async qrCode => {
      if (qrCode.scannedBy) {
        const user = await User.findById(qrCode.scannedBy).select('email').lean();
        if (user) {
          qrCode.scannedByEmail = user.email; // Add the user's email to the qrCode object
        }
      }
      return qrCode;
    }));

    res.render('viewQrCodes', { qrCodes: populatedQrCodes }); // Render the view with populated QR codes
  } catch (err) {
    console.error(err);
    res.status(500).send('Error retrieving QR Codes');
  }
});


// Start the Express server
module.exports = app
