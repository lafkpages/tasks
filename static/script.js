// Classes
class TaskList {
  constructor(data) {
    this.id = data.id || '';
    this.name = data.name || '';

    this.tasks = data.tasks || {};

    this.owner = data.owner || '';
    this.shared = data.shared || [];
  }
}

class Task {
  constructor(data) {
    this.id = data.id || '';
    this.taskListId = data.taskListId || '';
    this.name = data.name || '';

    this.description = data.description || '';
    this.completed = data.completed || false;
  }
}


// API functions
async function loadTaskLists() {
  const taskLists = await (await fetch('/lists')).json();
  for (const id of taskLists) tasksCache[id] = null;
  return taskLists;
}

async function loadTaskList(id, sse = true) {
  const taskList = new TaskList(await (await fetch(`/lists/${id}`)).json());
  tasksCache[id] = taskList;
  if (sse && !sseStreams[id]) {
    const sseStream = new EventSource(`/lists/${id}/events`);
    sseStream.taskListId = id;
    sseStream.addEventListener('error', sseStreamErrorHandler);
    sseStream.addEventListener('ping', sseStreamPingHandler);
    sseStream.addEventListener('newTask', sseStreamTaskListUpdateHandler);
    sseStream.addEventListener('updateTask', sseStreamTaskListUpdateHandler);
    sseStream.addEventListener('deleteTask', sseStreamTaskListUpdateHandler);
    sseStream.addEventListener('importTasks', sseStreamTaskListUpdateHandler);
    sseStreams[id] = sseStream;
  } return taskList;
}

async function newTaskList(name) {
  const resp = await fetch('/lists', {
    headers: {
      'Content-Type': 'text/plain'
    }, method: 'POST', body: name
  });

  if (resp.status == 200) {
    const taskList = new TaskList(await resp.json());
    tasksCache[taskList.id] = taskList;
    return taskList;
  } throw new Error(await resp.text());
}

async function newTask(id) {
  return await (await fetch(`/lists/${id}`, {
    method: 'POST'
  })).json();
}

async function deleteTaskList(id) {
  return await (await fetch(`/lists/${id}`, {
    method: 'DELETE'
  })).json();
}

async function updateTask(taskListId, id, data) {
  return await (await fetch(`/lists/${taskListId}/${id}`, {
    method: 'POST', body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' }
  })).json();
}

async function deleteTask(taskListId, id) {
  return await (await fetch(`/lists/${taskListId}/${id}`, {
    method: 'DELETE'
  })).json();
}

async function shareTaskList(taskListId, userId) {
  return await (await fetch(`/lists/${taskListId}/share/${userId}`, {
    method: 'POST'
  })).json();
}

async function lookupUser(id) {
  const resp = await (await fetch(`/users/${id}`)).text();
  return resp.length > 2? JSON.parse(resp) : null;
}

async function lookupUserByUsername(username) {
  const resp = await (await fetch(`/users/byUsername/${username}`)).text();
  return resp.length > 2? JSON.parse(resp) : null;
}

async function importTasks(taskListId, tasks, other) {
  return await (await fetch(`/lists/${taskListId}/import`, {
    method: 'POST', body: JSON.stringify({ tasks, other }),
    headers: { 'Content-Type': 'application/json' }
  })).json();
}


// HTML functions
function showDialog(options = {}) {
  return new Promise((resolve, reject) => {
    options = {
      input: false,
      select: false,
      ...options
    }; dialogTitle.textContent = options.title || '';
    dialogBody.innerHTML = options.body || '';
    dialog.classList.add('show');
    if (options.input) {
      dialogInput.value = '';
      dialog.classList.add('input');
      dialogInput.focus();
      if (options.input.minLength)
        dialogInput.minLength = options.input.minLength;
      else dialogInput.removeAttribute('minlength');
      if (options.input.maxLength)
        dialogInput.maxLength = options.input.maxLength;
      else dialogInput.removeAttribute('maxlength');
    } else dialog.classList.remove('input');
    if (options.select) {
      dialogSelect.textContent = '';
      dialog.classList.add('select');
      for (const opt of options.select.options) {
        const option = document.createElement('option');
        option.value = opt[0];
        option.textContent = opt[1];
        dialogSelect.appendChild(option);
      }
    } else dialog.classList.remove('select');
    dialogOk.onclick = () => {
      resolve([options.input? dialogInput.value : null, options.select? dialogSelect.value : null]);
    }; dialogCancel.onclick = reject;
  });
}

function closeDialog() {
  dialog.classList.remove('show');
}

async function updateTaskLists() {
  const taskLists = await loadTaskLists();

  if (!currentUser)
    currentUser = await getUserInfo();

  taskSelectTasks.textContent = '';
  taskSelectShared.textContent = '';

  for (const taskListId of taskLists) {
    const taskList = await loadTaskList(taskListId);
    const isOwner = currentUser.id == taskList.owner;
    const user = isOwner? currentUser : await lookupUser(taskList.owner);

    if (!user) continue;

    const opt = document.createElement('option');
    opt.value = taskSelectPrefix + taskListId;
    opt.textContent = `${taskList.name}${taskList.owner == currentUser.id? '' : ` (owned by ${user.displayName})`}`;

    (isOwner?
     taskSelectTasks :
     taskSelectShared
    ).appendChild(opt);
  }

  return taskLists;
}

function getSelectedTaskList() {
  if (taskSelect.value.startsWith(taskSelectPrefix)) {
    return taskSelect.value.substr(taskSelectPrefix.length);
  } else return null;
}

function selectTaskList(taskListId) {
  taskSelect.value = taskSelectPrefix + taskListId;
  if (!taskSelect.value) {
    taskSelect.value = 'null';
    window.location.hash = '#';
    deleteTaskListBtn.disabled = true;
    shareTaskListBtn.disabled = true;
    importTasksBtn.disabled = true;
    newTaskBtn.disabled = true;
    return false;
  } window.location.hash = `#taskList=${taskListId}`;
  tasks.textContent = '';
  deleteTaskListBtn.disabled = false;
  shareTaskListBtn.disabled = false;
  importTasksBtn.disabled = false;
  newTaskBtn.disabled = false;
  updateTasks();
  return true;
}

function makeTaskCard(task, i = 0) {
  const card = document.createElement('card');
  if (i % 2) card.classList.add('odd');
  card.dataset.taskId = task.id;
  if (task.completed) card.classList.add('completed');
  const completeBtn = document.createElement('a');
  completeBtn.className = 'cyan task-complete material-symbols-outlined';
  completeBtn.textContent = task.completed? 'Remove_Done' : 'Done';
  completeBtn.href = `javascript:completeTaskHandler('${task.taskListId}','${task.id}');`;
  const deleteBtn = document.createElement('a');
  deleteBtn.className = 'pink task-delete material-symbols-outlined';
  deleteBtn.textContent = 'delete';
  deleteBtn.href = `javascript:deleteTaskHandler('${task.taskListId}','${task.id}');`;
  const cardName = document.createElement('h4');
  cardName.className = 'task-name';
  cardName.contentEditable = true;
  cardName.textContent = task.name || 'Task name';
  if (!task.name) {
    cardName.classList.add('empty');
  } const cardDescription = document.createElement('p');
  cardDescription.className = 'task-description';
  cardDescription.contentEditable = true;
  cardDescription.innerText = task.description || 'Task description';
  if (!task.description) {
    cardDescription.classList.add('empty');
  } card.appendChild(completeBtn);
  card.appendChild(deleteBtn);
  card.appendChild(cardName);
  card.appendChild(cardDescription);
  return card;
}

function updateTasks() {
  const taskListId = getSelectedTaskList();

  const taskIds = Object.keys(tasksCache[taskListId].tasks);
  
  tasksDiv.textContent = '';

  if (taskIds.length == 0) {
    const span = document.createElement('p');
    span.textContent = 'There are no tasks in this Task List';
    span.className = 'tasklist-empty task-grow';
    tasksDiv.appendChild(span);
    return;
  }

  let completedIds = [];

  let lastCard = null;
  let i = 0;
  for (const id of taskIds) {
    const task = tasksCache[taskListId].tasks[id];
    if (task.completed) {
      completedIds.push(id);
      continue;
    } const card = makeTaskCard(task, i);
    tasksDiv.appendChild(card);
    lastCard = card;
    i++;
  }

  for (const id of completedIds) {
    const task = tasksCache[taskListId].tasks[id];
    const card = makeTaskCard(task, i);
    tasksDiv.appendChild(card);
    lastCard = card;
    i++;
  }

  if (taskIds.length % 2 && lastCard) {
    lastCard.classList.add('task-grow');
  }
}

function completeTaskHandler(taskListId, taskId) {
  tasksCache[taskListId].tasks[taskId].completed = !tasksCache[taskListId].tasks[taskId].completed;
  updateTask(taskListId, taskId, tasksCache[taskListId].tasks[taskId]).then(() => {
    loadTaskList(taskListId).then(() => {
      updateTasks();
    });
  });
}

function deleteTaskHandler(taskListId, taskId) {
  showDialog({
    title: 'Delete Task',
    body: `Are you sure you want to delete the task "${tasksCache[taskListId].tasks[taskId].name}"?`
  }).then(() => {
    console.log('Deleting Task', taskId);
    deleteTaskListBtn.disabled = true;
    shareTaskListBtn.disabled = true;
    importTasksBtn.disabled = true;
    newTaskBtn.disabled = true;
    deleteTask(taskListId, taskId).then(() => {
      loadTaskList(taskListId).then(() => {
        selectTaskList(taskListId);
      });
    });
  }).catch(() => {  });
}

function parseHash() {
  const parsed = new URLSearchParams(window.location.hash.substr(1));

  if (parsed.has('taskList')) {
    selectTaskList(parsed.get('taskList'));
  }
}

function makeUserLink(user, linkText = null) {
  if (!linkText) linkText = user.fullName || user.displayName || user.username;
  return `<a href="https://replit.com${user.url}" target="_blank" rel="noopener noreferrer" class="yellow" title="Username: ${user.username}\nFirst name: ${user.firstName}\nLast name: ${user.lastName}\nFull name: ${user.fullName}\nDisplay name: ${user.displayName}\nHas Hacker Plan: ${user.isSubscribed}\nEmail verified: ${user.isVerified}\nUser ID: ${user.id}\nIs banned from boards: ${user.isBannedFromBoards}">${linkText}</a>`;
}

function importTasksHandler(taskListId, tasks, other) {
  if (tasks.length > 0) {
    showDialog({
      title: 'Confirm Importing Tasks',
      body: `Are you sure you want to import <b>${tasks.length} tasks</b> into the Task List "${tasksCache[taskListId].name}"?`
    }).then(() => {
      deleteTaskListBtn.disabled = true;
      shareTaskListBtn.disabled = true;
      importTasksBtn.disabled = true;
      newTaskBtn.disabled = true;
      importTasks(taskListId, tasks, other).then(() => {
        loadTaskList(taskListId).then(() => {
          selectTaskList(taskListId);
        });
      });
    }).catch(() => {  });
  } else {
    showDialog({
      title: 'Import Tasks',
      body: 'No tasks found in your clipboard.'
    }).catch(() => {  });
  }
}

function generateTaskFromMatch(m) {
  let o = {
    completed: m[1] == '\u2713' || m[1] == 'x',
  }; if (m[2].length > 60) {
    o.description = m[2];
  } else o.name = m[2];
  return o;
}


// HTML
const taskSelect = document.getElementById('task-select');
const taskSelectTasks = document.getElementById('task-select-tasks');
const taskSelectShared = document.getElementById('task-select-shared');
const deleteTaskListBtn = document.getElementById('delete-tasklist');
const shareTaskListBtn = document.getElementById('share-tasklist');
const importTasksBtn = document.getElementById('import-tasks');
const newTaskBtn = document.getElementById('new-task');
const tasksDiv = document.getElementById('tasks');
const dialog = document.getElementById('dialog');
const dialogTitle = document.getElementById('dialog-title');
const dialogBody = document.getElementById('dialog-body');
const dialogInput = document.getElementById('dialog-input');
const dialogSelect = document.getElementById('dialog-select');
const dialogCancel = document.getElementById('dialog-cancel');
const dialogOk = document.getElementById('dialog-ok');


// Variables and constants
const taskSelectPrefix = 'task-';
let tasksCache = {};
let sseStreams = {};
let currentUser = null;


// Handlers
taskSelect.addEventListener('input', e => {
  if (taskSelect.value.startsWith(taskSelectPrefix)) {
    const id = getSelectedTaskList();
    selectTaskList(id);
    console.log('Selected task list:', id);
  } else if (taskSelect.value == 'new') {
    showDialog({
      title: 'Create new Task List',
      body: 'Enter the name of the new Task List',
      input: {
        minLength: 3,
        maxLength: 25
      }
    }).then(([name]) => {
      newTaskList(name).then(taskList => {
        updateTaskLists().then(() => {
          selectTaskList(taskList.id);
        });
      });
    }).catch(() => {
      taskSelect.value = 'null';
    });
  }
});

deleteTaskListBtn.addEventListener('click', e => {
  const taskListId = getSelectedTaskList();
  showDialog({
    title: 'Delete Task List',
    body: `You are about to delete the Task List "${tasksCache[taskListId].name}". Are you sure?`
  }).then(() => {
    deleteTaskListBtn.disabled = true;
    shareTaskListBtn.disabled = true;
    importTasksBtn.disabled = true;
    newTaskBtn.disabled = true;
    console.log('Deleting', taskListId);
    deleteTaskList(taskListId).then(() => {
      updateTaskLists().then(() => {
        selectTaskList(Object.keys(tasksCache)[0]);
      });
    });
  }).catch(() => {  });
});

shareTaskListBtn.addEventListener('click', async e => {
  const taskListId = getSelectedTaskList();

  let sharedLis = [];
  for (const userId of tasksCache[taskListId].shared) {
    const user = await lookupUser(userId);
    sharedLis.push(`<li>@${user.username} (${makeUserLink(user)})</li>`);
  }

  showDialog({
    title: 'Share Task List',
    body: `This Task List is shared with:<ul>${sharedLis.join('')}</ul><br>Enter the Replit username of the person you want to share with`,
    input: {
      minLength: 2,
      maxLength: 15
    }
  }).then(([username]) => {
    lookupUserByUsername(username).then(user => {
      console.log('Found user', username, 'ID:', user.id);
        showDialog({
        title: 'Confirm Sharing',
        body: `Are you sure you want to share the Task List "${tasksCache[taskListId].name}" with the user ${makeUserLink(user)}? Hover your mouse over their username for extra info.`
      }).then(() => {
        console.log('Sharing Task List with', user.username, user.id);
        shareTaskList(taskListId, user.id).then(() => {
          loadTaskList(taskListId).then(() => {
            selectTaskList(taskListId);
          });
        });
      }).catch(() => {  });
    });
  }).catch(() => {  });
});

importTasksBtn.addEventListener('click', e => {
  const taskListId = getSelectedTaskList();
  showDialog({
    title: 'Import Tasks',
    body: 'Import Tasks from other Task apps.',
    select: {
      options: [
        ['notes', 'Notes (iOS/macOS)']
      ]
    }
  }).then(([a, app]) => {
    switch (app) {
      case 'notes':
        showDialog({
          title: 'Import Tasks from Notes',
          body: 'Open Notes and select the Task List you want to import, and copy it to your clipboard. Then click Ok and allow reading the clipboard to import your Tasks.',
        }).then(() => {
          navigator.clipboard.readText().then(notes => {
            let tasks = [];
            let other = [];
            for (let line of notes.split('\n')) {
              line = line.trim();
              if (!line) continue;
              const m = line.match(/^-\s*\[( |x)\]\s*(.+)$/);
              if (m) {
                tasks.push(generateTaskFromMatch(m));
              } else {
                const m2 = line.match(/^(\u2713|\u25e6)\s*(.+)$/);
                if (m2) {
                  tasks.push(generateTaskFromMatch(m2));
                } else other.push(line);
              }
            } importTasksHandler(taskListId, tasks, other);
          });
        }).catch(() => {  });
        break;
    }
  }).catch(() => {  });
});

newTaskBtn.addEventListener('click', e => {
  const taskListId = getSelectedTaskList();
  newTask(taskListId).then(task => {
    loadTaskList(taskListId).then(() => {
      updateTasks();
      const name = tasksDiv.querySelector(`card[data-task-id="${task.id}"] .task-name`);
      name.click();
      name.focus();
    });
  });
});

document.addEventListener('click', e => {
  if (e.target.matches('div#tasks card .empty')) {
    e.target.classList.remove('empty');
    e.target.textContent = '';
    e.target.focus();
  } else if (document.activeElement.matches(':root body')) {
    try {
      updateTasks();
    } catch (err) {  }
  }
});

tasksDiv.addEventListener('input', e => {
  const taskListId = getSelectedTaskList();

  if (e.target.matches('div#tasks card .task-name')) {
    const taskId = e.target.parentElement.dataset.taskId;
    console.log('Edited Task name');
    e.target.textContent = e.target.textContent.replace(/\n/g, '');
    tasksCache[taskListId].tasks[taskId].name = e.target.textContent;
    console.log('Saving Task name');
    updateTask(taskListId, taskId, tasksCache[taskListId].tasks[taskId]).then(() => {
      loadTaskList(taskListId).then(() => {
        console.log('Saved Task name');
      });
    });
  } else if (e.target.matches('div#tasks card .task-description')) {
    const taskId = e.target.parentElement.dataset.taskId;
    console.log('Edited Task description');
    tasksCache[taskListId].tasks[taskId].description = e.target.innerText;
    console.log('Saving Task description');
    updateTask(taskListId, taskId, tasksCache[taskListId].tasks[taskId]).then(() => {
      loadTaskList(taskListId).then(() => {
        console.log('Saved Task description');
      });
    });
  }
});

tasksDiv.addEventListener('keydown', e => {
  const taskListId = getSelectedTaskList();

  if (e.code == 'Enter' && !e.shiftKey) {
    if (e.target.matches('div#tasks card .task-name')) {
      e.preventDefault();
      const taskId = e.target.parentElement.dataset.taskId;
      e.target.blur();
      const description = document.querySelector(`card[data-task-id="${taskId}"] .task-description`);
      description.focus();
      description.click();
    } else if (e.target.matches('div#tasks card .task-description')) {
      e.preventDefault();
      e.target.blur();
      updateTasks();
    }
  }
});

function sseStreamErrorHandler(e) {
  if (e.target.readyState == e.target.CLOSED) {
    showDialog({
      title: 'Disconnected from server',
      body: 'The connection to the server was lost. Please reload to reconnect.'
    }).then(() => {
      window.location.reload();
    }).catch(() => {  });
  }
}

function sseStreamPingHandler(e) {
  console.log(`SSE Stream for Task List "${tasksCache[e.target.taskListId].name}" connected`);
}

function sseStreamTaskListUpdateHandler(e) {
  console.log(`Task List "${tasksCache[e.target.taskListId].name}" was updated (${e.type})`);
  loadTaskList(e.target.taskListId).then(() => {
    if (e.data == currentUser.id) {
      console.log('Task List was updated but prevented updateTasks because it was updated by the current user');
    } else {
      updateTasks();
    }
  });
}

dialogInput.addEventListener('keydown', e => {
  if (e.code == 'Enter') {
    dialogOk.click();
  }
});

dialogCancel.addEventListener('click', e => {
  closeDialog();
});

dialogOk.addEventListener('click', e => {
  closeDialog();
});

window.addEventListener('hashchange', parseHash);


// Initialization
updateTaskLists().then(taskLists => {
  parseHash();
  const ids = taskLists;
  if (taskSelect.value == 'null' && ids.length > 0) {
    selectTaskList(ids[0]);
  }
});

getUserInfo().then(user => {
  currentUser = user;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => {
    console.log('Registered sw');
  }).catch(err => {
    console.log('SW Registration error:', err);
  });
}