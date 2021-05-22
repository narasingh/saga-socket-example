const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 }, () => {
    console.log('server started!!');
});
let inserts = [10,20,20,20,20,20,20];

wss.on('connection', function connection(ws) {
  console.log("Connection opened");
  ws.on('message', function incoming(message) {
    console.log('received: %s', message);
    if(message === 'close') {
      ws.close(); //quit this connection
      console.log('closed!!');
    }
  });

  setInterval(() => {
    const payload = { amount: inserts[0] };
    ws.send(JSON.stringify(payload));
  }, 2000)
});