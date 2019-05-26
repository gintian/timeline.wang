"use strict";

// Import modules.
var express     = require('express');
var sqlite      = require("sqlite");
var helmet      = require('helmet');
var compression = require('compression');
var passport    = require('passport');
var Strategy    = require('passport-local').Strategy;
var bcrypt      = require('bcrypt');
var moment      = require('moment');
var imgur       = require('imgur');
var https       = require('https');
var fs          = require('fs');

imgur.setClientId('4e62d0b8bda287e');

const { check, validationResult } = require('express-validator/check');

const saltRounds = 10;

// Create an express application.
var app = express();

// Use these middleware modules.
app.use(helmet());
app.use(compression());

passport.use(new Strategy(
  async function(username, password, cb) {
    find_by_username(username, async function(err, user) {
      if (err) { return cb(err); }
      if (!user) { return cb(null, false, { message: 'username' }); }
      const match = await bcrypt.compare(password, user.password);
      if (!match) { return cb(null, false, { message: 'password' }); }
      return cb(null, user);
    });
  }));

passport.serializeUser(function(user, cb) {
  cb(null, user.id);
});

passport.deserializeUser(function(id, cb) {
  find_by_id(id, function (err, user) {
    if (err) { return cb(err); }
    cb(null, user);
  });
});

// Use application-level middleware for common functionality, including
// logging, parsing, and session handling.
app.use(require('cookie-parser')());
app.use(require('body-parser').urlencoded({limit: '10mb', extended: true}));
app.use(require('body-parser').json({limit: '10mb', extended: true}));
app.use(require('express-session')({ secret: 'keyboard cat', resave: false, saveUninitialized: false }));
app.use(require('connect-flash')());

// Initialize Passport and restore authentication state, if any, from the
// session.
app.use(passport.initialize());
app.use(passport.session());

// Serve static files in the 'public' directory.
app.use(express.static('public'));

// Define routes.
app.get('/',
  function(req, res) {
    res.sendFile(__dirname + '/public/index.html');
  });

app.get('/timeline',
  function(req, res) {
    // res.render('timeline', { user: req.user });
    res.sendFile(__dirname + '/public/timeline.html');
  });

app.get('/about',
  function(req, res) {
    // res.render('about', { user: req.user });
    res.sendFile(__dirname + '/public/about.html');
  });

app.get('/login',
  function(req, res) {
    // res.render('login', { message: req.flash('error') });
    res.sendFile(__dirname + '/public/login.html');
  });

app.post('/login', function (req, res, next) {
  passport.authenticate('local', function (err, user, info) {
    if (err) { return next(err); }
    if (!user) {
      res.json(info);
    } else {
      req.login(user, function (err) {
        if (err) { return next(err); }
        res.json({ message: '' });
      });
    }
  }) (req, res, next);
});

app.get('/signup',
  function(req, res) {
    // res.render('signup', { errors: req.errors });
    res.sendFile(__dirname + '/public/signup.html');
  });

app.post('/signup',
  [
    check('firstname')
    .isLength({ min: 1 })
    .withMessage('firstname'),
    check('surname')
    .isLength({ min: 1 })
    .withMessage('surname'),
    check('username')
    .isLength({ min: 1 })
    .withMessage('username'),
    check('password')
    .isLength({ min: 5 })
    .withMessage('password')
  ],
  async function(req, res) {
    var errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json({ errors: errors.array() });
    } else {
      const body = req.body;
      var success = await register_user(body.username, body.password, body.firstname, body.surname);
      if (success) {
        res.json({ success: 'yes' });
      } else {
        const user_error = [{ location: 'body',
                              param:    'username',
                              value:    '',
                              msg:      'alreadyexists' }];
        res.json({ errors: user_error });
      }
    }
  });

app.post('/contribute',
  [
    check('title')
    .isLength({ min: 1 })
    .withMessage('title_min')
    .isLength({ max: 40 })
    .withMessage('title_max'),
    check('description')
    .isLength({ min: 1 })
    .withMessage('description_min')
    .isLength({ max: 300 })
    .withMessage('description_max'),
    check('date')
    .isLength({ min: 1 })
    .withMessage('date'),
  ],
  function (req, res) {
    var errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.json({ errors: errors.array() });
    } else {
      const body = req.body;
      var time = moment().format("HH:mm:ss-YYYY-MM-DD");
      imgur.uploadBase64(body.image)
        .then(function (json) {
          add_contribution(body.title, body.date, body.description, json.data.link, req.user.id, time);
          res.json({ errors: '' });
        })
        .catch(function (err) {
          console.error(err.message);
        });
    }
  });

app.get('/user',
  async function (req, res) {
    var user = req.user;
    if (user) {
      var join_date = moment(user.joindate, "YYYY-MM-DD");
      user.joindate = moment(join_date).format('MMMM Do YYYY');
      res.json(user);
    } else {
      res.status(500).send('No user');
    }
  });

app.get('/contributions',
  async function (req, res) {
    var user_id = req.user.id;
    var contributions = await get_contributions(user_id);
    res.json(contributions);
  });

app.get('/all_contributions',
  async function (req, res) {
    var contributions = await get_all_contributions();
    res.json(contributions);
  });

app.get('/logout',
  function (req, res) {
    req.logout();
    res.redirect('/');
  });

app.get('/profile',
  require('connect-ensure-login').ensureLoggedIn(),
  function(req, res) {
    // res.render('profile', { user: req.user });
    res.sendFile(__dirname + '/public/profile.html');
  });

if (process.argv[2] === 'local') {
  app.listen(process.env.PORT || 8080, function() {
    console.log('Server listening on port 8080...');
  });
} else {
  https.createServer({
      key: fs.readFileSync('/etc/letsencrypt/live/timeline.wang/privkey.pem'),
      cert: fs.readFileSync('/etc/letsencrypt/live/timeline.wang/fullchain.pem'),
      passphrase: 'ainsley'
  }, app)
  .listen(process.env.PORT || 8080, function() {
    console.log('Server listening on port 8080...');
  });
}

async function find_by_username(username, cb) {
  try {
    var db = await sqlite.open("./db.sqlite");
    // Using prepared statements to prevent SQL injection attacks
    var ps = await db.prepare("select * from users where username=?");
    var user = await ps.get(username);
    await ps.finalize();
    if (!user) {
      return cb(null, null);
    } else {
      return cb(null, user);
    }
  } catch (error) {
    console.log(error);
  }
}

async function find_by_id(id, cb) {
  try {
    var db = await sqlite.open("./db.sqlite");
    // Using prepared statements to prevent SQL injection attacks
    var ps = await db.prepare("select * from users where id=?");
    var user = await ps.get(id);
    await ps.finalize();
    if (!user) {
      cb(new Error('User ' + id + ' does not exist'));
    } else {
      cb(null, user);
    }
  } catch (error) {
    console.log(error);
  }
}

async function register_user(username, password, firstname, surname) {
  try {
    var db = await sqlite.open("./db.sqlite");
    var ps = await db.prepare("select * from users where username=?");
    var user = await ps.get(username);
    await ps.finalize();
    if (!user) {
      await bcrypt.hash(password, saltRounds, async function(err, hash) {
        var ps = await db.prepare("insert into users (username, password, firstname, surname, contributions, joindate)" +
                                   "values ( ?, ?, ?, ?, ?, ? )");

        var date_string = moment().format('YYYY-MM-DD');
        await ps.run(username, hash, firstname, surname, 0, date_string);
        await ps.finalize();
      });
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.log(error);
  }
}

async function add_contribution(title, historical_date, description, image, user_id, contribution_date) {
  try {
    var db = await sqlite.open("./db.sqlite");
    var ps = await db.prepare("select username from users where id=?");
    var user = await ps.get(user_id);
    await ps.finalize();

    var historical = moment(historical_date, "YYYY-MM-DD");
    var cont_date  = moment(contribution_date, "HH:mm:ss-YYYY-MM-DD");
    var beginning  = moment("0000-01-01", "YYYY-MM-DD");
    var serialised_hist_date = historical.diff(moment(beginning), 'days');
    var serialised_cont_date = cont_date.diff(moment(beginning), 'seconds');

    ps = await db.prepare("insert into contributions (contributor_id, contributor_username," +
                          "contribution_date, serialised_cont_date, historical_date,"        +
                          "serialised_hist_date, title, image_source, description, likes)"   +
                          "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    await ps.run(user_id, user.username, contribution_date, serialised_cont_date,
                 historical_date, serialised_hist_date, title, image, description, 0);
    await ps.finalize();

    ps = await db.prepare("select * from contributions where contributor_id=?");
    var contributions = await ps.all(user_id);
    await ps.finalize();

    ps = await db.prepare("update users set contributions=? where id=?");
    await ps.run(contributions.length, user_id);
    await ps.finalize();

  } catch (error) {
    console.log(error);
  }
}

async function get_contributions(user_id) {
  try {
    var db = await sqlite.open("./db.sqlite");
    var ps = await db.prepare("select * from contributions where contributor_id = ?");
    var contributions = await ps.all(user_id);
    await ps.finalize();
    await contributions.forEach(contribution => {
      var contribution_date = moment(contribution.contribution_date, "HH:mm:ss-YYYY-MM-DD");
      var historical_date   = moment(contribution.historical_date, "YYYY-MM-DD");
      contribution.contribution_date = moment(contribution_date).fromNow();
      contribution.historical_date   = moment(historical_date).format('MMMM Do YYYY');
    });
    return contributions;
  } catch (error) {
    console.log(error);
  }
}

async function get_all_contributions() {
  try {
    var db = await sqlite.open("./db.sqlite");
    var ps = await db.prepare("select * from contributions");
    var contributions = await ps.all();
    await ps.finalize();
    await contributions.forEach(contribution => {
      var historical_date = moment(contribution.historical_date, "YYYY-MM-DD");
      contribution.historical_date = moment(historical_date).format('MMMM Do YYYY');
    });
    return contributions;
  } catch (error) {
    console.log(error);
  }
}
