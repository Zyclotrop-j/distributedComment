
var key = window.peerjskey;

var peer = new Peer(Object.assign({
    debug: 1,
    // key: 'peerjs', // Crete new room
    // config: {'iceServers': [
    //    {url:'stun:stun.l.google.com:19302'},
    //    {url:'stun:stun1.l.google.com:19302'},
    //    {url:'stun:stun2.l.google.com:19302'},
    //    {url:'stun:stun3.l.google.com:19302'},
    //    {url:'stun:stun4.l.google.com:19302'},
    //]}
}, window.peerjskey || console.error('No peerjskey found!')));

var fingerprint;
var cinput;
var $c = $('#c');
var $log = $('#log');
var $ident = $('#ident');
var connections = [];
var myid = 'uninit';
var findPeers;
var send = 'SEND';
var receiver = 'RECEIVE';
var commands = {
    DATA: 'DATA',
};
var knowledge = {};

function sortVisualItems() {
    $log.find('tr:not(.head)').sort(function(a,b) {
         return JSON.parse(atob($(a).data('data'))).time > JSON.parse(atob($(b).data('data'))).time;
    }).appendTo($log);
}
function td(c){
    return '<td>'+c+'</td>'
}
function draw(data) {
    return td(moment(data.time).format('llll')) + td(data.value) + td(data.author || 'annonymous') + td(data.fingerprint || 'undeteced');
}

peer.on('open', function(id) {
      console.log('My peer ID is: ' + id);
      $('#myid').text(id);
      myid = (id);
});

function createKey() {
    return myid + Date.now();
}

function handleSetup(conn, role) {
    if (connections.map(function(i){ return i.peer }).concat([myid]).indexOf(conn.peer) > -1) {
        return console.log('Peer already known, skipping peer ' + conn.peer, role);
    }
    
    conn.on('open', function() {
      if (connections.map(function(i){ return i.peer }).indexOf(conn.peer) === -1) {
        connections.push(conn);
        console.info('Established connection to '+conn.peer);
        localforage.iterate(function(value, key, iterationNumber) {
            knowledge[value.key] = value;
            conn.send({
                command: commands.DATA,
                key: value.key,
                value: value.value,
                time: value.time,
                author:value.author,
                fingerprint: value.fingerprint,
            });
        }).then(function() {
            console.log('Distributed knowledge');
        }).catch(function(err) {
            // This code runs if there were any errors
            console.log(err);
        }); 
      }
      // Receive messages
      conn.on('data', function(_data) {
        var data = Object.assign({}, _data);
        if (data.command === commands.DATA) {
            if (!data.key || !data.value) return;
            if (!knowledge[data.key]) {
                knowledge[data.key] = data;
                localforage.setItem(data.key, data).then(function () {
                     if (knowledge[data.key] && knowledge[data.key].time > data.time) {
                        console.warn('Not overwriting existing entry', data.value, data.key);
                    } else {
                        knowledge[data.key] = data;
                        $log.append($('<tr data-data="'+btoa(JSON.stringify(data))+'">'+draw(data)+'</tr>'));
                        sortVisualItems();
                    }
                }).catch(function(err) {
                    // This code runs if there were any errors
                    console.error(err, data);
                    cinput.disabled = false;
                });
            }
            
        }
        
      });
      $('#cid, #c').remove();
      if (!cinput) {
            cinput = $('<input type="text" placeholder="message">');
            $('#chatinputcontainter').html(cinput);
        }
      cinput.keyup(function(e){
        if(e.keyCode == 13 && cinput.val() && cinput.val().trim())
        {
            console.log('Sending data to '+ connections.map(function(i){ return i.peer }).join(', '));
            var key = createKey();
            var value = cinput.val() + '';
            if (!value) return;
            var data = {
                    command: commands.DATA,
                    key: key,
                    value: value,
                    time: Date.now(),
                    author: $ident.val(),
                    fingerprint: fingerprint,
                };
            localforage.setItem(key, data).then(function () {
                // Do other things once the value has been saved.
                knowledge[key] = data;
                connections.forEach(function(i){ i.send(data); });
                $log.append($('<tr data-data="'+btoa(JSON.stringify(value))+'">'+draw(data)+'</tr>'));
                sortVisualItems();
                cinput.disabled = false;
            }).catch(function(err) {
                // This code runs if there were any errors
                console.log(err);
                cinput.disabled = false;
            });
            cinput.val('');
            cinput.disabled = true;
        }
      });
    });
}

var nobodyOnline = null;
findPeers = function() {
    $.get('http'+(window.peerjskey.secure ? 's' : '')+'://'+window.peerjskey.host+(window.peerjskey.port ? (':' + window.peerjskey.port) : '')+window.peerjskey.path+window.peerjskey.key+'/peers').then(function(data){
        var knownPeers = connections.map(function(i){ return i.peer }).concat([myid]);
        var tmp = data.filter(function(i){ return knownPeers.indexOf(i) === -1 });
        tmp.forEach(function(i) {
            var conn = peer.connect(i);
            handleSetup(conn, send);
        });
        if (data.length <= 1) {
            $('#chatinputcontainter').html('Nobody online!');
            nobodyOnline = true;
        } else {
            if (!cinput) {
                cinput = $('<input type="text" placeholder="message">');
                $('#chatinputcontainter').html(cinput);
                nobodyOnline = false;
            }
            if (nobodyOnline) {
                $('#chatinputcontainter').html(cinput);
            }
            nobodyOnline = false;
        }
        
        window.setTimeout(function() {
            findPeers();
        }, 1000);
    }).catch(function() {
        window.setTimeout(function() {
            findPeers();
        }, 1000);
    });
}

peer.on('connection', function(conn) {
    handleSetup(conn, receiver);
});

localforage.iterate(function(value, key, iterationNumber) {
    // Resulting key/value pair -- this callback
    // will be executed for every item in the
    // database.
    if (knowledge[value.key] && knowledge[value.key].time > value.time) {
        console.warn('Not overwriting existing entry', value, key);
    } else {
        $log.append($('<tr data-me="'+(fingerprint === value.fingerprint)+'" data-data="'+btoa(JSON.stringify(value))+'">'+draw(value)+'</tr>'));
        sortVisualItems();
        knowledge[value.key] = value;
    }
}).then(function() {
    //var cfingerprint = ( new ClientJS()).getFingerprint();
    new Fingerprint2().get(function(result, components){
      fingerprint = result;
      findPeers();
    });
}).catch(function(err) {
    // This code runs if there were any errors
    console.log(err);
});



