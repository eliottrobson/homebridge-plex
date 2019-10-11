# Homebridge Plex
Homebridge plugin to track Plex webhook events (play / pause / stop)

# Installation

Install the plugin
```
npm config set registry "https://npm.pkg.github.com"
sudo npm install @eliottrobson/homebridge-plex -g
ln -s /usr/local/lib/node_modules/@eliottrobson/homebridge-plex /usr/local/lib/node_modules/homebridge-@eliottrobson-plex
```

Configure in homebridge config
```
{
    "platform": "homebridge-plex.Plex",
    "sensors": [
        {
            "name": "Plex Playing"
        },
        {
            "name": "Plex - TV Show Playing",
            "media": ["episode"],
            "players": ["Bedroom TV"],
            "users": ["eliottrobson"]
        },
        {
            "name": "Plex - Movie Playing",
            "media": ["movie"],
            "players": ["Bedroom TV"],
            "users": ["eliottrobson"]
        }
    ],
    "port": 32512
}
```

Setting up plex

You will need plex pass in order to add the webhook to your Plex account, first visit the following url:

https://app.plex.tv/desktop#!/settings/webhooks

Click "ADD WEBHOOK" and enter the url of the homebridge server with port 32512 (this can be changed in settings). (Example: http://192.168.86.100:32512).

# Config
Variable | Description
-------- | -----------
`sensors` | This is the array of sensor objects (see sensor-config below).
`port` | (Optional) The custom port to use (default: 32512)

## Sensor Config
Variable | Description
-------- | -----------
`name` | This will be the name of this sensor, is is required and must be unique.
`users` | (Optional) This is a filter for the different plex users required to trigger the sensor
`players` | (Optional) This is a filter for the different plex players required to trigger the sensor
`types` | (Optional) This is a filter for the types of media required to trigger the sensor (episode, movie, track)
`delay` | (Optional) Applies an optional delay to the off status to avoid quick off->on when moving between songs etc...

# Debugging
```
DEBUG=* /usr/local/bin/homebridge -D -U ~/Documents/Homebridge/homebridge-dev -P ~/Documents/Source/homebridge-plex
```