const http = require('http');

let Accessory, Characteristic, Service, UUIDGen;

const pluginName = "homebridge-plex-webhooks";
const platformName = "Plex";

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory;
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform(pluginName, platformName, Plex, true);
};

function Plex(log, config, api) {
	// Setup dependencies
	this.log = log;
	this.api = api;
	this.accessories = {};
	this.sensors = config["sensors"] || [];
	this.port = config["port"] || 32512;

	if (!config) {
		log.warn("Ignoring homebridge-plex because it is not configured");
        return;
	}	

	this.delays = {};

	const self = this;

	// Homebridge has finished loading cached accessories
	this.api.on("didFinishLaunching", function() {
		for (var sensor of self.sensors) {
			var uuid = UUIDGen.generate(sensor.name);

			if (!self.accessories[uuid])  {
				self.log("Adding '" + sensor.name + "' sensor.");
	
				// Create the accessory for the occupancy sensor
				var accessory = new Accessory(sensor.name, uuid);
				var service = accessory.addService(Service.Outlet, sensor.name);
				
				self.accessories[uuid] = accessory;
				sensor.accessory = accessory;
				sensor.service = service;
				
				// Register the accessory with Homebridge
				self.api.registerPlatformAccessories(pluginName, platformName, [ accessory ]);
			} else {
				self.log("Updating '" + sensor.name + "' sensor.");
			}
	
			// Add information to the new accessory
			var informationService = sensor.accessory.getService(Service.AccessoryInformation);
	
			informationService
				.setCharacteristic(Characteristic.Manufacturer, "Homebridge Sensors for Plex")
				.setCharacteristic(Characteristic.Model, "Plex Sensor")
				.setCharacteristic(Characteristic.SerialNumber, sensor.name);

			sensor.service
				.getCharacteristic(Characteristic.On)
				.on("get", function(callback) {
					callback(sensor.isOn);
				});
		
			sensor.service
				.getCharacteristic(Characteristic.OutletInUse)
				.on("get", function(callback) {
					callback(sensor.isPlaying);
				});

			// Setup sensor	
			self.setupSensor(sensor);
		}
		
        self.appBeginListening();
	});
}

// Invoked when homebridge tries to restore cached accessory
Plex.prototype.configureAccessory = function(accessory) {
	var foundAccessory = false;

	for (var sensor of this.sensors) {
		if (accessory.services[1].displayName == sensor.name) {
			foundAccessory = true;
			this.log("Configuring '" + accessory.displayName + "' sensor.");

			this.accessories[accessory.UUID] = accessory;

			sensor.accessory = accessory;
			sensor.service = accessory.services[1];

			this.setupSensor(sensor);
		}
	}

	if (!foundAccessory) {
		this.log("Removing '" + accessory.displayName + "' sensor.");
		this.api.unregisterPlatformAccessories(pluginName, platformName, [ accessory ]);
	}
}

Plex.prototype.setupSensor = function(sensor) {
	sensor.isOn = false;
	sensor.isPlaying = false;
	sensor.activePlayers = new Set();

	sensor.service.getCharacteristic(Characteristic.On).updateValue(sensor.isOn);
	sensor.service.getCharacteristic(Characteristic.OutletInUse).updateValue(sensor.isPlaying);
}

Plex.prototype.appBeginListening = function() {
	const self = this;

	// Listen to plex webhooks
	this.server = http.createServer(function(request, response) {
		let body = [];
		
        request.on('data', (chunk) => {
			body.push(chunk);
		});
		
		request.on('end', () => {
			body = Buffer.concat(body).toString();

			var boundary = request.headers['content-type'].split('boundary=')[1];
			var splitBody = body.split(boundary);

			for (var item of splitBody) {
				var jsonStart = item.indexOf("{");
				var jsonEnd = item.lastIndexOf("}");

				if (jsonStart > -1 && jsonEnd > -1) {
					var json = item.substring(jsonStart, jsonEnd + 1);
					self.httpHandler(json);
				}
			}
			
			response.end("");
        });
    });
    
    this.server.listen(this.port, function(){
        self.log("Homebridge Plex listening for webhooks at: http://<homebridge_ip>:%s", self.port);
    });
}

Plex.prototype.httpHandler = function(body) {
	var event;

	try {
        event = JSON.parse(body);
    }
    catch(e) {
		// this.log("Plex webhook called with invalid json", e);
		// this.log(body);
	}
	
	if (!event)
		return;

	// Ignore non playback events
	if (["media.play", "media.pause", "media.resume", "media.stop"].indexOf(event.event) === -1)
		return;

	for (var sensor of this.sensors) {
		this.eventHandler(event, sensor);   
	}
}

Plex.prototype.eventHandler = function(event, sensor) {
	// Apply users filter
	if (sensor.users && sensor.users.length > 0 && sensor.users.indexOf(event.Account.title) === -1)
        return;

	// Apply players filter
	if (sensor.players && sensor.players.length > 0 && sensor.players.indexOf(event.Player.title) == -1 
		&& sensor.players.indexOf(event.Player.uuid) == -1)
		return;
	
	// Apply types filter
	if (sensor.types && sensor.types.length > 0 && sensor.types.indexOf(event.Metadata.type) == -1)
		return;
		
	if (event.event === "media.play" || event.event === "media.resume") {
		// Remove any pending delays
		if (this.delays.hasOwnProperty(sensor.name)) {
			clearTimeout(this.delays[sensor.name]);
		}

		// Add the player to the list of triggers
		sensor.activePlayers.add(event.Player.uuid);

		this.log("Updating playing state: PLAYING");

		sensor.isOn = true;
		sensor.isPlaying = true;
		sensor.service.getCharacteristic(Characteristic.On).updateValue(true);
		sensor.service.getCharacteristic(Characteristic.OutletInUse).updateValue(true);
	} else if (event.event == "media.pause") {
		// Remove the player from the list of active triggers
		sensor.activePlayers.delete(event.Player.uuid);

		// If there are no other players currently active we can process the pause event
		if (sensor.activePlayers.size == 0) {
			this.log("Updating playing state: PAUSED");

			sensor.isOn = true;
			sensor.isPlaying = false;
			sensor.service.getCharacteristic(Characteristic.On).updateValue(true);
			sensor.service.getCharacteristic(Characteristic.OutletInUse).updateValue(false);
		}
	} else if (event.event == "media.stop") {
		// Remove the player from the list of active triggers
		sensor.activePlayers.delete(event.Player.uuid);

		// If there are no other players currently active we can process the stop event
		if (sensor.activePlayers.size == 0) {
			// Remove any pending delays
			if (this.delays.hasOwnProperty(sensor.name)) {
				clearTimeout(this.delays[sensor.name]);
			}

			let triggerOff = (function() {
				this.log("Updating playing state: STOPPED");

				sensor.isOn = false;
				sensor.isPlaying = false;
				sensor.service.getCharacteristic(Characteristic.On).updateValue(false);
				sensor.service.getCharacteristic(Characteristic.OutletInUse).updateValue(false);
			}).bind(this)

			if (sensor.delay && sensor.delay > 0) {
				this.delays[sensor.name] = setTimeout(triggerOff, sensor.delay);
			} else {
				triggerOff();
			}
		}		
	}
}