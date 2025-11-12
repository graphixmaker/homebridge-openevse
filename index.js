'use strict';

const http = require('http');
const https = require('https');

let Accessory, Service, Characteristic;

module.exports = (api) => {
  Accessory = api.platformAccessory;
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;

  api.registerAccessory('OpenEVSE', OpenEVSEAccessory);
};

class OpenEVSEAccessory {
  constructor(log, config) {
    this.log = log;
    this.config = config;
    this.name = config.name || 'EV Charger';
    this.host = config.host;
    this.port = config.port || 80;
    this.username = config.username;
    this.password = config.password;
    this.pollInterval = (config.pollInterval || 10) * 1000;

    // State
    this.isCharging = false;
    this.currentWatts = 0;
    this.currentAmps = 0;

    // Services
    this.switchService = new Service.Switch(this.name);
    this.powerService = new Service.LightSensor(this.name + ' Power'); // Reuse LightSensor for watts
    this.currentService = new Service.TemperatureSensor(this.name + ' Amps'); // Reuse for amps (float)

    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'OpenEVSE')
      .setCharacteristic(Characteristic.Model, 'WiFi Charger')
      .setCharacteristic(Characteristic.SerialNumber, 'Unknown');

    // Bind getters
    this.switchService.getCharacteristic(Characteristic.On)
      .onGet(this.getChargingState.bind(this));

    this.powerService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
      .onGet(this.getCurrentWatts.bind(this));

    this.currentService.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentAmps.bind(this));

    // Start polling
    this.startPolling();
  }

  getServices() {
    return [
      this.informationService,
      this.switchService,
      this.powerService,
      this.currentService
    ];
  }

  // --- Getters ---
  getChargingState() {
    return this.isCharging;
  }

  getCurrentWatts() {
    return this.currentWatts; // lux = watts
  }

  getCurrentAmps() {
    return this.currentAmps; // °C = amps (float)
  }

  // --- Polling ---
  startPolling() {
    this.poll();
    this.interval = setInterval(() => this.poll(), this.pollInterval);
  }

  poll() {
    const protocol = this.port === 443 ? https : http;
    const options = {
      hostname: this.host,
      port: this.port,
      path: '/status',
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    };

    if (this.username && this.password) {
      const auth = 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64');
      options.headers.Authorization = auth;
    }

    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.stat !== undefined) {
            const wasCharging = this.isCharging;
            this.isCharging = json.stat === 3;

            // Update values only when charging; 0 when not
            this.currentWatts = this.isCharging && json.watts !== undefined ? json.watts : 0;
            this.currentAmps = this.isCharging && json.amps !== undefined ? parseFloat(json.amps) : 0;

            // Update characteristics
            if (wasCharging !== this.isCharging) {
              this.switchService.updateCharacteristic(Characteristic.On, this.isCharging);
              this.log(`${this.name} → ${this.isCharging ? 'Charging' : 'Idle'}`);
            }

            this.powerService.updateCharacteristic(Characteristic.CurrentAmbientLightLevel, this.currentWatts);
            this.currentService.updateCharacteristic(Characteristic.CurrentTemperature, this.currentAmps);
          }
        } catch (err) {
          this.log.error(`JSON parse error: ${err.message}`);
        }
      });
    });

    req.on('error', (err) => {
      this.log.error(`HTTP error: ${err.message}`);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      this.log.warn('Request timeout');
    });

    req.end();
  }

  // Cleanup
  shutdown() {
    if (this.interval) clearInterval(this.interval);
  }
}
