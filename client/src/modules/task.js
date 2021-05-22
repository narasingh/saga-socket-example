/* eslint-disable no-param-reassign */
import {eventChannel, delay} from 'redux-saga';
import {take, call, put, fork, race, cancelled, select } from 'redux-saga/effects';
import {createSelector} from 'reselect';
import { clone } from 'lodash';
import WebSocketReconnector from 'reconnecting-websocket';

const ADD_TASK = 'ADD_TASK';
const START_CHANNEL = 'START_CHANNEL';
const STOP_CHANNEL = 'STOP_CHANNEL';
const CHANNEL_ON = 'CHANNEL_ON';
const CHANNEL_OFF = 'CHANNEL_OFF';
const SERVER_ON = 'SERVER_ON';
const SERVER_OFF = 'SERVER_OFF';
const ELEMENT_ENQUEUE = 'ELEMENT_ENQUEUE';
// const ELEMENT_PICK = 'ELEMENT_PICK';
const ELEMENT_DEQUEUE = 'ELEMENT_DEQUEUE';

const socketServerURL = 'ws://localhost:3000';
let socket;

const initialState = {
  taskList: [],
  queue: [],
  channelStatus: 'off',
  serverStatus: 'unknown',
};

export default (state = initialState, action) => {
  const {taskList} = state;
  const updatedTaskList = [...taskList, action.payload];
  switch (action.type) {
    case CHANNEL_ON:
      return {...state, channelStatus: 'on'};
    case CHANNEL_OFF:
      return {...state, channelStatus: 'off', serverStatus: 'unknown'};
    case ADD_TASK:
      return {...state, taskList: updatedTaskList};
    case ELEMENT_ENQUEUE:
      return {
        ...state,
        queue: [
          ...state.queue,
          action.payload.amount,
        ],
      };
    // eslint-disable-next-line no-case-declarations
    case ELEMENT_DEQUEUE:
      const queue = clone(state.queue);
      queue.shift();
      return {
        ...state,
        queue,
      };
    case SERVER_OFF:
      return {...state, serverStatus: 'off'};
    case SERVER_ON:
      return {...state, serverStatus: 'on'};
    default:
      return state;
  }
};

// action creators for Stop and Start buttons. You can also put them into componentDidMount
export const startChannel = () => ({type: START_CHANNEL});
export const stopChannel = () => ({type: STOP_CHANNEL});

// sorting function to show the latest tasks first
const sortTasks = (task1, task2) => task2.taskID - task1.taskID;

// selector to get only first 5 latest tasks
const taskSelector = state => state.taskReducer.taskList;
const processQueue = state => state.taskReducer.queue;
const topTask = allTasks => allTasks.sort(sortTasks).slice(0, 5);

export const topTaskSelector = createSelector(taskSelector, topTask);
export const itemQueue = createSelector(processQueue, queue => queue);
export const pickQueue = createSelector(itemQueue, queue => (queue.length ? queue[0] : undefined));

// wrapping functions for socket events (connect, disconnect, reconnect)
const connect = () => new Promise((resolve) => {
  socket = new WebSocketReconnector(socketServerURL, [], {
    maxRetries: 5,
    minReconnectionDelay: 3000,
  });
  socket.onopen = () => {
    console.log('connection open!!');
    socket.send('Hello Server!');
    resolve(socket);
  };
});

const disconnect = () => new Promise((resolve) => {
  socket.onclose = () => {
    console.log('connection closed!!');
  };

  socket.onerror = (evt) => {
    console.log('connection lost!', evt);
    resolve(socket);
  };
});

// This is how channel is created
const createSocketChannel = (socket = {}) => eventChannel((emit) => {
  const handleInsert = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      // eslint-disable-next-line prefer-destructuring
      data = event.data;
    }
    emit(data);
  };

  socket.onmessage = handleInsert;

  const unsubscribe = () => {
    socket.close = handleInsert;
  };

  return unsubscribe;
});

// connection monitoring sagas
const listenDisconnectSaga = function* () {
  while (true) {
    yield call(disconnect);
    yield put({type: SERVER_OFF});
  }
};

export const processAPI = payload => new Promise((resolve, reject) => {
  setTimeout(() => {
    if (payload) {
      resolve(payload);
    } else {
      reject(payload);
    }
  }, 2000);
});

export const processRequestQueue = function* (payload) {
  try {
    const pick = yield select(pickQueue);
    const data = {
      ...payload,
      amount: pick,
    };
    const response = yield call(processAPI, data);
    if (response) {
      yield put({ type: ELEMENT_DEQUEUE });
      const queue = yield select(itemQueue);
    }
  } catch (error) {
    console.log(error);
  }
};

// Saga to switch on channel.
const listenServerSaga = function* () {
  try {
    yield put({type: CHANNEL_ON});
    const {timeout} = yield race({
      connected: call(connect),
      timeout: delay(10000),
    });
    if (timeout) {
      // yield put({type: SERVER_OFF});
      console.log('timed out!!');
    }
    const socket = yield call(connect);
    const socketChannel = yield call(createSocketChannel, socket);
    yield fork(listenDisconnectSaga);

    while (true) {
      const payload = yield take(socketChannel);
      console.log(payload);
      if (payload.taskID) yield put({type: ADD_TASK, payload});
      if (payload.amount) {
        yield put({type: ELEMENT_ENQUEUE, payload });
        yield call(processRequestQueue, { type: 'cash' });
      }
    }
  } catch (error) {
    console.log(error);
  } finally {
    if (yield cancelled()) {
      socket.close();
      yield put({type: CHANNEL_OFF});
    }
  }
};

// saga listens for start and stop actions
export const startStopChannel = function* () {
  while (true) {
    yield take(START_CHANNEL);
    yield race({
      task: call(listenServerSaga),
      cancel: take(STOP_CHANNEL),
    });
  }
};
