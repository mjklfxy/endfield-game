'use strict';

const { createPlatform } = require('./src/platform-douyin');
const { createGame } = require('./src/game-app');

// Start native launch tracking before constructing the game and restoring its local save.
createGame(createPlatform(tt));
