'use strict';

var log = (label, message0, message1) => {
  var mess = new Date().toJSON() + ' - ' + label + ': ' + message0;
  //var mess = '- ' + label + ': ' + message0;

  if (message1 !== undefined) {
    mess += ' - ' + message1;
  }

  console.log(mess);
}

module.exports = log;