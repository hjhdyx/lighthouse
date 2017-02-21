/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const Connection = require('./connection.js');
const WebSocket = require('ws');
const http = require('http');
const log = require('../../lib/log.js');

const hostname = 'localhost';
const CONNECT_TIMEOUT = 10000;
const DEFAULT_PORT = 9222;

class CriConnection extends Connection {
  /**
   * @param {number=} port Optional port number. Defaults to 9222;
   * @constructor
   */
  constructor(port) {
    super();

    this.port = port || DEFAULT_PORT;
  }

  /**
   * @override
   * @return {!Promise}
   */
  connect() {
    return this._runJsonCommand('new')
        .then(response => this._connectToSocket(response), this.newTabFallback.bind(this));
  }

  _connectToSocket(response) {
    log.log('lo', response)
    const url = response.webSocketDebuggerUrl;
    this._pageId = response.id;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        perMessageDeflate: false
      });
      ws.on('open', () => {
        this._ws = ws;
        resolve();
      });
      ws.on('message', data => this.handleRawMessage(data));
      ws.on('close', this.dispose.bind(this));
      ws.on('error', reject);
    });
  }

  // called if /json/new fails (e.g. in headless)
  newTabFallback() {
    // const createTargetMsg = JSON.stringify({
    //   id: 1,
    //   method: 'Target.createTarget',
    //   params: {url: 'about:blank'}
    // });
    let webSocketDebuggerUrl;
    let id;
    let targetData;

    return this._runJsonCommand('list')
      // hold on to id and ws URL of
      .then(tabs => ({webSocketDebuggerUrl, id} = tabs[0]))
      .then(tab => this._connectToSocket(tab))

      .then(_ => this.sendCommand('Target.closeTarget', {targetId: id}))


//       .then(_ => this.sendCommand('Target.createTarget', {url: 'about:blank'}))
//       .then(target => {
//       targetData = target;
//       })
//       .then(_ => this._runJsonCommand('list'))
// //       .then(x => log.log('hi', x) || x)
//       .then(_ => this.sendCommand('Target.getTargetInfo', targetData))
      .then(data => {
        const targetInfo = data.targetInfo;
        const newId = targetInfo.targetId;
        const newWSURL = webSocketDebuggerUrl.replace(id, newId);
        log.log('uh', data);

        return this.disconnect().then(_ => {
          const newTabResponse = {
            id: targetInfo.targetId,
            webSocketDebuggerUrl: newWSURL
          };
          // log.log('connecting to new', newTabResponse)
          // return this._connectToSocket(newTabResponse);
        }).catch(e => log.error('ruh', e))
      });
  }

  /**
   * @param {!string} command
   * @return {!Promise<string>}
   */
  _runJsonCommand(command) {
    return new Promise((resolve, reject) => {
      const request = http.get({
        hostname: hostname,
        port: this.port,
        path: '/json/' + command
      }, response => {
        let data = '';
        response.on('data', chunk => {
          data += chunk;
        });
        response.on('end', _ => {
          if (response.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
              return;
            } catch (e) {
              // In the case of 'close' Chromium returns a string rather than JSON: goo.gl/7v27xD
              if (data === 'Target is closing') {
                return resolve({message: data});
              }
              return reject(e);
            }
          }
          reject(new Error(`Protocol JSON API error (${command}), status: ${response.statusCode}`));
        });
      });

      request.setTimeout(CONNECT_TIMEOUT, _ => {
        request.abort();

        // After aborting, we expect an ECONNRESET error. Ignore.
        request.on('error', err => {
          if (err.code !== 'ECONNRESET') {
            throw err;
          }
        });

        // Reject on error with code specifically indicating timeout in connection setup.
        const err = new Error('Timeout waiting for initial Debugger Protocol connection.');
        err.code = 'CRI_TIMEOUT';
        log.error('CriConnection', err.message);
        reject(err);
      });
    });
  }

  /**
   * @override
   */
  disconnect() {
    if (!this._ws) {
      log.warn('CriConnection', 'disconnect() was called without an established connection.');
      return Promise.resolve();
    }
    return this._runJsonCommand(`close/${this._pageId}`).then(_ => {
      this._ws.removeAllListeners();
      this._ws.close();
      this._ws = null;
      this._pageId = null;
    });
  }

  /**
   * @override
   * @param {string} message
   */
  sendRawMessage(message) {
    this._ws.send(message);
  }
}

module.exports = CriConnection;
