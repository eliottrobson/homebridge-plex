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
				var accessoryOn = new Accessory(sensor.name + " - On", UUIDGen.generate(sensor.name + " - On"));
				var serviceOn = accessoryOn.addService(Service.OccupancySensor, sensor.name + " - On");
				
				var accessoryPlaying = new Accessory(sensor.name + " - Playing", UUIDGen.generate(sensor.name + " - Playing"));
				var servicePlaying = accessoryPlaying.addService(Service.OccupancySensor, sensor.name + " - Playing");

				self.accessories[uuid] = { accessoryOn: accessoryOn, accessoryPlaying: accessoryPlaying };
				sensor.accessoryOn = accessoryOn;
				sensor.accessoryPlaying = accessoryPlaying;
				sensor.serviceOn = serviceOn;
				sensor.servicePlaying = servicePlaying;
				
				// Register the accessory with Homebridge
				self.api.registerPlatformAccessories(pluginName, platformName, [ accessoryOn, accessoryPlaying ]);
			} else {
				self.log("Updating '" + sensor.name + "' sensor.");
			}
	
			// Add information to the new accessory
			var informationServiceOn = sensor.accessoryOn.getService(Service.AccessoryInformation);
	
			informationServiceOn
				.setCharacteristic(Characteristic.Manufacturer, "Homebridge Sensors for Plex")
				.setCharacteristic(Characteristic.Model, "Plex Sensor (On)")
				.setCharacteristic(Characteristic.SerialNumber, sensor.name);

			var informationServicePlaying = sensor.accessoryPlaying.getService(Service.AccessoryInformation);
	
			informationServicePlaying
				.setCharacteristic(Characteristic.Manufacturer, "Homebridge Sensors for Plex")
				.setCharacteristic(Characteristic.Model, "Plex Sensor (Playing)")
				.setCharacteristic(Characteristic.SerialNumber, sensor.name);

			// Setup sensor	
			self.setupSensor(sensor);
		}
		
        self.appBeginListening();
	});
}

// Invoked when homebridge tries to restore cached accessory
Plex.prototype.configureAccessory = function(accessory) {
	var foundOnAccessory = false;
	var foundPlayingAccessory = false;

	for (var sensor of this.sensors) {
		if (accessory.services[1].displayName == sensor.name + " - On") {
			foundOnAccessory = true;
			this.log("Configuring '" + accessory.displayName + "' sensor.");

			if (!this.accessories[accessory.UUID]) {
				this.accessories[accessory.UUID] = {};
			}

			this.accessories[accessory.UUID].accessoryOn = accessory;

			sensor.accessoryOn = accessory;
			sensor.serviceOn = accessory.services[1];

			if (foundOnAccessory && foundPlayingAccessory) {
				this.setupSensor(sensor);
			}
		} else if (accessory.services[1].displayName == sensor.name + " - Playing") {
			foundOnAccessory = true;
			this.log("Configuring '" + accessory.displayName + "' sensor.");

			if (!this.accessories[accessory.UUID])
				this.accessories[accessory.UUID] = {};

			this.accessories[accessory.UUID].accessoryPlaying = accessory;

			sensor.accessoryPlaying = accessory;
			sensor.servicePlaying = accessory.services[1];

			if (foundOnAccessory && foundPlayingAccessory) {
				this.setupSensor(sensor);
			}
		}
	}

	if (!foundOnAccessory && !foundPlayingAccessory) {
		this.log("Removing '" + accessory.displayName + "' sensor.");
		this.api.unregisterPlatformAccessories(pluginName, platformName, [ accessory ]);
	}
}

Plex.prototype.setupSensor = function(sensor) {
	sensor.isOn = false;
	sensor.isPlaying = false;
	sensor.activePlayers = new Set();

	sensor.serviceOn.getCharacteristic(Characteristic.OccupancyDetected).updateValue(sensor.isOn);
	sensor.servicePlaying.getCharacteristic(Characteristic.OccupancyDetected).updateValue(sensor.isPlaying);
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
		sensor.serviceOn.getCharacteristic(Characteristic.OccupancyDetected).updateValue(sensor.isOn);
		sensor.servicePlaying.getCharacteristic(Characteristic.OccupancyDetected).updateValue(sensor.isPlaying);
	} else if (event.event == "media.pause") {
		// Remove the player from the list of active triggers
		sensor.activePlayers.delete(event.Player.uuid);

		// If there are no other players currently active we can process the pause event
		if (sensor.activePlayers.size == 0) {
			this.log("Updating playing state: PAUSED");

			sensor.isOn = true;
			sensor.isPlaying = false;
			sensor.serviceOn.getCharacteristic(Characteristic.OccupancyDetected).updateValue(sensor.isOn);
			sensor.servicePlaying.getCharacteristic(Characteristic.OccupancyDetected).updateValue(sensor.isPlaying);
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
				sensor.serviceOn.getCharacteristic(Characteristic.OccupancyDetected).updateValue(sensor.isOn);
				sensor.servicePlaying.getCharacteristic(Characteristic.OccupancyDetected).updateValue(sensor.isPlaying);
			}).bind(this)

			if (sensor.delay && sensor.delay > 0) {
				this.delays[sensor.name] = setTimeout(triggerOff, sensor.delay);
			} else {
				triggerOff();
			}
		}		
	}
}