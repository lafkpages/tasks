const express = require('express');
const { getUserInfo } = require("@replit/repl-auth");
const ReplitDB = require("@replit/database");
const { GraphQLClient } = require("graphql-request");
const fetch = require('@replit/node-fetch');
const fs = require('fs');

const app = express();
app.use(express.text({ type: 'text/*' }));
app.use(express.json());

const db = new ReplitDB();

const KEYS = {
  LISTS: 'lists'
};

const admins = [ '9868101' ];

const COLOR = 0x41f5c5;

const client = new GraphQLClient(`https://replit.com/graphql?e=${Math.round(Math.random() * 100)}`, {
  headers: {
	  "X-Requested-With": "replit",
  	Origin: "https://replit.com",
  	Accept: "application/json",
  	Referrer: "https://replit.com",
  	"Content-Type": "application/json",
  	Connection: "keep-alive",
  	Host: "replit.com",
  	"User-Agent": "Mozilla/5.0",
    Cookie: 'connect.sid='
  }
});

const sseHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-store',
  'Connection': 'keep-alive'
};

let sseStreams = {
  taskLists: {},
  taskList: {},
};

async function lookupUser(id, byUsername = false) {
  let data = await client.batchRequests([{
    document: `query {\n  user${byUsername? 'ByUsername' : ''}(${byUsername? 'username' : 'id'}: ${byUsername? (`"${id}"`) : id}) {\n    id, username, url, bio, isVerified, firstName, lastName, displayName,
    fullName, isLoggedIn, isSubscribed, timeCreated, isBannedFromBoards,
    image\n  }\n}`,
    variables: {}
  }]);

  data = data.length === 1 ? data[0].data : data.map((query) => query.data);

  return byUsername? data.userByUsername : data.user;
}

function randomId(ids) {
  let id = '';
  while ((!id) || id in ids) {
    id = Math.random().toString(16).substr(2) + '-' + Math.random().toString(16).substr(2);
  } return id;
}

async function webhook(msg) {
  if (typeof msg == 'string') {
    msg = { content: msg };
  }

  return await (await fetch(process.env.WEBHOOK + '?wait=true', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(msg)
  })).text();
}

app.get('/', (req, res, next) => {
  const user = getUserInfo(req);

  if (user) {
    next();
    return;
  } res.redirect('/login');
});

app.get('/login', (req, res, next) => {
  const user = getUserInfo(req);

  if (!user) {
    next();
    return;
  } res.redirect('/');

  webhook({
    embeds: [{
      title: 'User Logged In',
      color: COLOR,
      description: 'A user logged in to Tasks',
      fields: [{
        name: 'User ID',
        value: user.id.toString(),
        inline: true
      }, {
        name: 'Roles',
        value: user.roles?.join(', ') || '_no roles_',
        inline: true
      }, {
        name: 'Teams',
        value: user.teams?.join(', ') || '_no teams_',
        inline: true
      }],
      author: {
        name: user.name,
        url: user.url,
        icon_url: user.profileImage
      }
    }]
  });
});

app.get('/lists', (req, res) => {
  const user = getUserInfo(req);
  user.id = user.id.toString();

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  db.get(KEYS.LISTS).then(lists => {
    let toSend = [];
    for (const list of Object.entries(lists)) {
      if (list[1].owner == user.id || list[1].shared?.includes(user.id) || admins.includes(user.id)) {
        toSend.push(list[0]);
      }
    } res.send(toSend);
  });
});

app.get('/lists/:id', (req, res) => {
  const user = getUserInfo(req);
  user.id = user.id.toString();

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  db.get(KEYS.LISTS).then(lists => {
    const list = lists[req.params.id];

    if (!list) {
      res.status(404);
      res.send('4 List does not exist');
      return;
    }

    if (list.owner != user.id && (!list.shared?.includes(user.id)) && (!admins.includes(user.id))) {
      res.status(403);
      res.send('5 You don\'t have access to this Task List');
      return;
    }

    res.send(list);
  });
});

app.post('/lists', (req, res) => {
  const user = getUserInfo(req);

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  if (typeof req.body != 'string') {
    res.status(400);
    res.send('1 Invalid or no request body');
    return;
  }

  const name = req.body.replace(/[^ -\]a-~]/gi, '').trim();

  if (name.length < 3) {
    res.status(400);
    res.send('2 Request body too short');
    return;
  } else if (name.length > 25) {
    res.status(400);
    res.send('3 Request body too long');
    return;
  }

  db.get(KEYS.LISTS).then(lists => {
    const n1 = Object.keys(lists).length;
    const id = randomId(lists); const list = {
      id, name, tasks: {  }, owner: user.id.toString()
    }; lists[id] = list;
    const n2 = Object.keys(lists).length;
    db.set(KEYS.LISTS, lists).then(() => {
      res.send(list);
      console.log(`Created list "${name}" (${id}), lists ${n1}/${n2}`);
    });
  });
});

app.post('/lists/:id', (req, res) => {
  const user = getUserInfo(req);
  user.id = user.id.toString();

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  db.get(KEYS.LISTS).then(lists => {
    const list = lists[req.params.id];

    if (!list) {
      res.status(404);
      res.send('4 List does not exist');
      return;
    }

    if (list.owner != user.id && (!list.shared?.includes(user.id)) && (!admins.includes(user.id))) {
      res.status(403);
      res.send('5 You don\'t have access to this Task List');
      return;
    }

    const id = randomId(list.tasks); list.tasks[id] = {
      id, taskListId: list.id, name: '',
      description: '', completed: false
    };

    if (sseStreams.taskList[list.id]) {
      for (const sseStream of sseStreams.taskList[list.id]) {
        sseStream.write(`event: newTask\ndata: ${user.id}\n\n`);
      }
    }

    db.set(KEYS.LISTS, lists).then(() => {
      res.send(list.tasks[id]);
      console.log(`Updated list "${list.name}" (${list.id}), new task created`);
    });
  });
});

app.post('/lists/:taskListId/share/:userId', (req, res) => {
  const user = getUserInfo(req);
  user.id = user.id.toString();

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  if (user.id == req.params.userId) {
    res.status(403);
    res.send('A You can\'t share a Task List with yourself');
    return;
  }

  lookupUser(req.params.userId).then(user2 => {
    if (!user2) {
      res.status(404);
      res.send('7 User to share to doesn\'t exist');
      return;
    }

    user2.id = user2.id.toString();

    db.get(KEYS.LISTS).then(lists => {
      const list = lists[req.params.taskListId];
  
      if (!list) {
        res.status(404);
        res.send('4 List does not exist');
        return;
      }

      if (list.owner != user.id && (!admins.includes(user.id))) {
        res.status(403);
        res.send('8 Only owners and admins can share Task Lists');
        return;
      }

      if (!list.shared)
        list.shared = [];

      if (list.shared.includes(user2.id)) {
        res.status(403);
        res.send('9 You already shared this Task List with this user');
        return;
      }

      list.shared.push(user2.id);

      db.set(KEYS.LISTS, lists).then(() => {
        res.send(list);
        console.log(` Shared list "${list.name}" (${list.id}) with user "${user2.username}"`);
      });
    });
  });
});

app.post('/lists/:taskListId/import', (req, res) => {
  const user = getUserInfo(req);
  user.id = user.id.toString();

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  if (typeof req.body != 'object') {
    res.status(400);
    res.send('1 Invalid or no request body');
    return;
  }

  db.get(KEYS.LISTS).then(lists => {
    const list = lists[req.params.taskListId];

    if (!list) {
      res.status(404);
      res.send('4 List does not exist');
      return;
    }

    if (list.owner != user.id && (!list.shared?.includes(user.id)) && (!admins.includes(user.id))) {
      res.status(403);
      res.send('5 You don\'t have access to this Task List');
      return;
    }

    let ids = [];
    for (const taskData of req.body.tasks) {
      const id = randomId(list.tasks);
      ids.push(id);
      list.tasks[id] = {
        id, taskListId: list.id,
        name: taskData.name || '',
        description: taskData.description || '',
        completed: typeof taskData.completed == 'boolean'? taskData.completed : false
      };
    }

    if (sseStreams.taskList[list.id]) {
      for (const sseStream of sseStreams.taskList[list.id]) {
        sseStream.write(`event: importTasks\ndata: ${user.id}\n\n`);
      }
    }

    db.set(KEYS.LISTS, lists).then(() => {
      res.send(ids);
      console.log(`Updated list "${list.name}", imported ${req.body.tasks.length} Tasks`);
    });
  });
});

app.post('/lists/:taskListId/:taskId', (req, res) => {
  const user = getUserInfo(req);
  user.id = user.id.toString();

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  if (typeof req.body != 'object') {
    res.status(400);
    res.send('1 Invalid or no request body');
    return;
  }

  db.get(KEYS.LISTS).then(lists => {
    const list = lists[req.params.taskListId];

    if (!list) {
      res.status(404);
      res.send('4 Task List does not exist');
      return;
    }

    if (list.owner != user.id && (!list.shared?.includes(user.id)) && (!admins.includes(user.id))) {
      res.status(403);
      res.send('5 You don\'t have access to this Task List');
      return;
    }

    const task = list.tasks[req.params.taskId];

    if (!task) {
      res.status(404);
      res.send('6 Task does not exist');
      return;
    }

    task.name = req.body.name || task.name;
    task.description = req.body.description || task.description;
    task.completed = typeof req.body.completed? req.body.completed : task.completed;

    lists[req.params.taskListId].tasks[req.params.taskId] = task;

    if (sseStreams.taskList[list.id]) {
      for (const sseStream of sseStreams.taskList[list.id]) {
        sseStream.write(`event: updateTask\ndata: ${user.id}\n\n`);
      }
    }

    db.set(KEYS.LISTS, lists).then(() => {
      res.send(task);
      console.log(`Updated task "${task.name}" (${task.id})`);
    });
  });
});

app.delete('/lists/:id', (req, res) => {
  const user = getUserInfo(req);
  user.id = user.id.toString();

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  db.get(KEYS.LISTS).then(lists => {
    const list = lists[req.params.id];

    if (!list) {
      res.status(404);
      res.send('4 List does not exist');
      return;
    }

    if (list.shared?.includes(user.id)) {
      res.status(403);
      res.send('B Only owners and admins can delete Task Lists');
      return;
    }

    if (list.owner != user.id && (!admins.includes(user.id))) {
      res.status(403);
      res.send('5 You don\'t have access to this Task List');
      return;
    }

    const n1 = Object.keys(lists).length;

    delete lists[req.params.id];

    const n2 = Object.keys(lists).length;

    db.set(KEYS.LISTS, lists).then(() => {
      console.log(`Deleted list "${list.name}" (${list.id}), lists ${n1}/${n2}`);
      res.send('true');
    });
  });
});

app.delete('/lists/:taskListId/:taskId', (req, res) => {
  const user = getUserInfo(req);
  user.id = user.id.toString();

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  db.get(KEYS.LISTS).then(lists => {
    const list = lists[req.params.taskListId];

    if (!list) {
      res.status(404);
      res.send('4 Task List does not exist');
      return;
    }

    if (list.owner != user.id && (!list.shared?.includes(user.id)) && (!admins.includes(user.id))) {
      res.status(403);
      res.send('5 You don\'t have access to this Task List');
      return;
    }

    const task = list.tasks[req.params.taskId];

    if (!task) {
      res.status(404);
      res.send('6 Task does not exist');
      return;
    }

    const n1 = Object.keys(list.tasks).length;

    delete list.tasks[req.params.taskId];

    const n2 = Object.keys(list.tasks).length;

    if (sseStreams.taskList[list.id]) {
      for (const sseStream of sseStreams.taskList[list.id]) {
        sseStream.write(`event: deleteTask\ndata: ${user.id}\n\n`);
      }
    }

    db.set(KEYS.LISTS, lists).then(() => {
      console.log(`Deleted task "${task.name}" (${user.id}), tasks ${n1}/${n2}`);
      res.send('true');
    });
  });
});

app.get(/^\/users\/.+$/, (req, res, next) => {
  const origins = [
    'https://hack-the-website-2-server.luisafk.repl.co',
    'https://hack-the-website-3-server.luisafk.repl.co'
  ];

  if (origins.includes(req.headers.origin))
    res.set('Access-Control-Allow-Origin', req.headers.origin);

  next();
});

app.get('/users/byUsername/:username', (req, res) => {
  lookupUser(req.params.username, true).then(user => {
    res.send(user);
  });
});

app.get('/users/:id', (req, res) => {
  lookupUser(req.params.id).then(user => {
    res.send(user);
  });
});

app.get('/lists/:id/events', (req, res) => {
  const user = getUserInfo(req);
  user.id = user.id.toString();

  if (!user) {
    res.status(401);
    res.send('3 Unauthorized');
    return;
  }

  db.get(KEYS.LISTS).then(lists => {
    const list = lists[req.params.id];

    if (!list) {
      res.status(404);
      res.send('4 Task List does not exist');
      return;
    }

    res.writeHead(200, sseHeaders);
    res.write(`event: ping\ndata: ${user.id}\n\n`);

    if (!sseStreams.taskList[list.id]) {
      sseStreams.taskList[list.id] = [];
    }

    sseStreams.taskList[list.id].push(res);

    console.log(`Created list "${list.name}" SSE, ${sseStreams.taskList[list.id].length}/${Object.keys(sseStreams.taskList).length}`);

    req.on('close', () => {
      sseStreams.taskList[list.id] = sseStreams.taskList[list.id].filter(res2 => res2 !== res);
      if (sseStreams.taskList[list.id].length <= 0) {
        delete sseStreams.taskList[list.id];
      } console.log(` Closed list "${list.name}" SSE`);
    });
  });
});

app.use(express.static(__dirname + '/static'));
app.listen(3000, () => {
  if (process.env.REPL_OWNER == 'LuisAFK') {
    console.log(`Database: https://replit-database-viewer.luisafk.repl.co/?url=${Buffer.from(process.env.REPLIT_DB_URL, 'ascii').toString('base64')}`);
  }
});

// Make default keys
db.get(KEYS.LISTS).then(lists => {
  if (!lists) {
    db.set(KEYS.LISTS, {});
  }
}).catch(err => {
  console.error('Error reading lists, deleting key');
  db.delete(KEYS.LISTS).then(() => {
    db.set(KEYS.LISTS, {});
  });
});

// Load BounceCSS and save locally
(['bounce.css', 'Fonts/Clash Display/ClashDisplay-Bold.otf', 'Fonts/Clash Display/ClashDisplay-Semibold.otf', 'Fonts/Clash Grotesk/ClashGrotesk-Medium.otf']).forEach(filename => {
  fetch(`https://bouncecss.bookie0.repl.co/${encodeURI(filename)}`).then(res => {
    const file = fs.createWriteStream(__dirname + `/static/${filename}`);
    res.body.pipe(file);
  });
}); fetch('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24..48,700,0,200').then(res => {
  const file = fs.createWriteStream(__dirname + '/static/symbols.css');
  res.body.pipe(file);
}); fs.readFile(__dirname + '/static/_index.html', 'ascii', (err1, index) => {
  if (err1) {
    console.error(err1);
    return;
  } fs.readFile(__dirname + '/static/bounce.css', 'ascii', (err2, bounce) => {
    if (err2) {
      console.error(err2);
      return;
    } fs.readFile(__dirname + '/static/symbols.css', 'ascii', (err3, symbols) => {
      if (err3) {
        console.error(err3);
        return;
      } fs.writeFile(__dirname + '/static/index.html', index.replace('<link rel="stylesheet" href="/bounce.css">', `<style id="bounce-css">\n${bounce.replace(/^(.+)$/gm, '    $1')}\n  </style>`).replace('<link rel="stylesheet" href="/symbols.css">', `<style id="symbols-css">\n${symbols.replace(/^(.+)$/gm, '    $1')}\n  </style>`), 'ascii', err4 => {
        if (err4) {
          console.error(err4);
          return;
        }
      });
    }); fs.readFile(__dirname + '/static/_offline.html', 'ascii', (err5, offline) => {
      if (err5) {
        console.error(err5);
        return;
      
      } fs.writeFile(__dirname + '/static/offline.html', offline.replace('<link rel="stylesheet" href="/bounce.css">', `<style id="bounce-css">\n${bounce.replace(/^(.+)$/gm,'   $1')}\n  </style>`), 'ascii', err6 => {
        if (err6) {
          console.error(err6);
          return;
        }
      });
    });
  });
});