// Browser compatability check --------------------------------------------------------------------

if(!window.indexedDB) {
  document.body.innerHTML = "Unfortunately, your browser doesn't support IndexedDB. This is required for Route Timer to work.";
}


// Database setup ---------------------------------------------------------------------------------

// Use Dexie as a wrapper for the browser's IndexedDB
var db = new Dexie("route-timer");

// Display any uncaught errors
Dexie.Promise.on('error', function(err) {
  console.error("Uncaught error: " + err);
});

// Create database structure
db.version(3).stores({
  timers: 'timerRunning,trip,route,departureTime',
  entries: '++id,trip,route,departureTime,arrivalTime,duration',
  trips: '++id,name',
  routes: '++id,name,parentTrip',
  state: 'id,trip,route'
}).upgrade(function(t) {
  console.info("Database upgraded to version 3");
});

// Open the database
db.open().catch(function(error) {
  console.error(error);
});

// Route Timer object - stores a copy of the database data for use during runtime
var rt = {
  "entries": {
    "list": []
  },
  "timers": {
    "list": []
  },
  "routes": {
    "list": []
  },
  "trips": {
    "averages": [],
    "list": []
  },
  "state": {
    "trip": null,
    "route": null,
    "help": 0
  }
};


// Viewmodel --------------------------------------------------------------------------------------

var app = new Vue({
  data: rt,
  el: 'body',
  methods: {
    getTrips: function(mode) {
      rt.trips.list = [];
      db.transaction("r", db.trips, db.state, function() {
        db.trips.orderBy('id').each(function(trip) {
          rt.trips.list.push({
            "id": trip.id,
            "name": trip.name
          });
        });
        // If this is the initial page load, use the trip and route IDs from the database
        if(mode === "init") {
          db.state.each(function(state) {
            rt.state.trip = state.trip;
            rt.state.route = state.route;
          });
        }
      }).then(function() {
        // If there's no trip set, just use the ID of the first entry instead
        if(!rt.state.trip) {
          rt.state.trip = parseInt(rt.trips.list[0].id, 10);
        }
        app.getRoutes(mode);
      }).catch(function(error) {
        console.log("Could not load trips, or there are no trips. " + error);
      });
    },
    getRoutes: function(mode) {
      rt.routes.list = [];
      db.routes.where("parentTrip").equals(parseInt(rt.state.trip, 10)).each(function(route) {
        rt.routes.list.push({'id': route.id, 'name': route.name, 'parentTrip': route.parentTrip});
      }).then(function() {
        if(mode === "init") {
          // We already have the route set from getTrips(), nothing more to do
        } else if(!isNaN(parseInt(mode, 10))) {
          // If a number was passed into this function, use that as the new ID
          rt.state.route = mode;
        } else {
          // Otherwise, just use the ID of the first entry
          rt.state.route = parseInt(rt.routes.list[0].id, 10);
        }
        app.getTimers();
        app.getEntries();
        app.updateState();
      }).catch(function(error) {
        console.log("Could not load routes, or there are no routes. " + error);
      });
    },
    getEntries: function() {
      rt.entries.list = [];
      db.entries.where("trip").equals(parseInt(rt.state.trip, 10)).reverse().each(function(entry) {
        rt.entries.list.push({
          "arrivalTime": entry.arrivalTime,
          "departureTime": entry.departureTime,
          "duration": entry.duration,
          "id": entry.id,
          "route": entry.route,
          "routeName": app.lookupRouteName(entry.route),
          "trip": entry.trip
        });
      }).then(function() {
        // Calculate average times for each route
        var routeTimes = {};
        for(var routeIndex in rt.routes.list) {
          if(rt.routes.list.hasOwnProperty(routeIndex)) {
            var routeId = rt.routes.list[routeIndex].id;
            if(!routeTimes[routeId]) {
              routeTimes[routeId] = [];
            }
            for(var entryIndex in rt.entries.list) {
              if(rt.entries.list[entryIndex].route === routeId) {
                routeTimes[routeId].push(rt.entries.list[entryIndex].duration);
              }
            }
          }
        }
        rt.trips.averages = [];
        for(var route in routeTimes) {
          if(routeTimes.hasOwnProperty(route)) {
            var sum = 0, fastestRouteTime = 0, averageRouteTime = 0, slowestRouteTime = 0;
            for(var i=0; i<routeTimes[route].length; i++) {
              sum += routeTimes[route][i];
              if(fastestRouteTime === 0) {
                fastestRouteTime = routeTimes[route][i];
              }
              if(routeTimes[route][i] < fastestRouteTime) {
                fastestRouteTime = routeTimes[route][i];
              }
              if(routeTimes[route][i] > slowestRouteTime) {
                slowestRouteTime = routeTimes[route][i];
              }
            }
            averageRouteTime = parseFloat(sum/routeTimes[route].length);
            rt.trips.averages.push({average: averageRouteTime, fastest: fastestRouteTime, slowest: slowestRouteTime, name: app.lookupRouteName(route), route: route});
          }
        }
      });
    },
    getTimers: function() {
      db.timers.each(function(timer) {
        rt.timers.list.push({timerRunning: timer.timerRunning});
      });
    },
    addTrip: function() {
      var newTripName = window.prompt("Add a new trip name (e.g. 'Home to Work'):");
      if(newTripName !== null) {
        db.trips.add({name: newTripName}).then(function(newIndex) {
          rt.state.trip = newIndex;
          app.getTrips("new");
        });
      }
    },
    removeTrip: function() {
      var remove = window.confirm("Are you sure you want to remove this trip AND all of its associated routes and log entries?");
      if(remove) {
        var id = parseInt(rt.state.trip, 10);
        db.transaction("rw", db.trips, db.routes, db.entries, function() {
          db.trips.where('id').equals(id).delete();
          db.routes.where('parentTrip').equals(id).delete();
          db.entries.where('trip').equals(id).delete();
        }).then(function() {
          app.getTrips();
        }).catch(function(error) {
          console.error(error);
        });
      }
    },
    addRoute: function(routeName, parentTrip) {
      var newRouteName = window.prompt("New route name (e.g. 'Route 71'):");
      if(newRouteName !== null) {
        db.routes.add({name: newRouteName, parentTrip: parseInt(rt.state.trip, 10)}).then(function(newIndex) {
          app.getRoutes(newIndex);
        });
      }
    },
    removeRoute: function() {
      var remove = window.confirm("Are you sure you want to remove this route AND all of its associated log entries?");
      if(remove) {
        var id = parseInt(rt.state.route, 10);
        db.transaction("rw", db.routes, db.entries, function() {
          db.routes.where('id').equals(id).delete();
          db.entries.where('route').equals(id).delete();
        }).then(function() {
          app.getRoutes();
        }).catch(function(error) {
          console.error(error);
        });
      }
    },
    lookupRouteName: function(routeId) {
      var lookup = {};
      for(var i = 0; i < rt.routes.list.length; i++) {
        lookup[rt.routes.list[i].id] = rt.routes.list[i];
      }
      return lookup[routeId].name || "";
    },
    addEntry: function(trip, route, departureTime, arrivalTime) {
      db.entries.add({trip: trip, route: route, departureTime: departureTime, arrivalTime: arrivalTime, duration: (arrivalTime - departureTime)});
      db.timers.clear();
    },
    removeEntry: function(id) {
      var remove = window.confirm("Are you sure you want to remove this log entry?");
      if(remove) {
        db.entries.where('id').equals(parseInt(id, 10)).delete().then(function() {
          app.getEntries();
        });
      }
    },
    startTimer: function() {
      db.timers.add({timerRunning: 1, trip: parseInt(rt.state.trip, 10), route: parseInt(rt.state.route, 10), departureTime: Date.now()});
      rt.timers.list.push({timerRunning: 1});
    },
    stopTimer: function() {
      db.timers.each(function(timer) {
        app.addEntry(timer.trip, timer.route, timer.departureTime, Date.now());
      }).then(function() {
        db.timers.clear();
        rt.timers.list = [];
        app.getEntries();
      });
    },
    updateState: function() {
      // Save the current trip and route IDs to the database so they can be remembered on next page refresh
      db.transaction("rw", db.state, function() {
        db.state.clear();
        db.state.add({id: 0, trip: parseInt(rt.state.trip, 10), route: parseInt(rt.state.route, 10)});
      });
    },
    exportDatabase: function() {
      // Output the entire IndexedDB database as a JSON object
      return db.transaction('r', db.tables, function() {
        var tables = db.tables.map(function(t) {
          return Dexie.currentTransaction.tables[t.name];
        });
        var result = [];
        return exportNextTable();
        function exportNextTable() {
          var table = tables.shift();
          return table.toArray().then(function(a) {
            result.push({
              tableName: table.name,
              contents: a
            });
            return tables.length > 0 ? exportNextTable() : result;
          });
        }
      }).then(function(dbObj) {
        var json = JSON.stringify(dbObj);
        document.body.innerHTML = json;
      });
    },
    clearAll: function() {
      var remove = window.confirm("Are you sure you want to remove ALL data from Route Timer?");
      if(remove) {
        indexedDB.deleteDatabase('route-timer');
        window.location.reload();
      }
    }
  }
});


// Filters ----------------------------------------------------------------------------------------

Vue.filter('date', function(timestamp) {
  var date = new Date();
  date.setTime(timestamp);
  var year = date.getFullYear().toString().substring(2);
  var month = date.getMonth() + 1;
  var day = date.getDate();
  var hour = date.getHours();
  var min = date.getMinutes();
  month = (month < 10 ? "0" : "") + month;
  day = (day < 10 ? "0" : "") + day;
  hour = (hour < 10 ? "0" : "") + hour;
  min = (min < 10 ? "0" : "") + min;
  return month + "/" + day + "/" + year + " " + hour + ":" + min;
});

Vue.filter('minutes', function(milliseconds) {
  if(isNaN(milliseconds) || milliseconds === 0) {
    return "(no data yet)";
  } else {
    return (milliseconds/1000/60).toFixed(1) + " min.";
  }
});


// Initial load -----------------------------------------------------------------------------------

app.getTrips("init");
