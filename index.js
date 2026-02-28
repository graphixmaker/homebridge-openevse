'use strict';

const http = require('http');
const mqtt = require('mqtt');

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory('OpenEVSE', OpenEVSEAccessory);
};

class OpenEVSEAccessory {
  constructor(log, config) {
    this.log = log;
    this.config = config;
    this.name = config.name || 'EV Charger';
    this.host = config.host;
    this.baseTopic = config.mqtt_topic || 'openevse';
    
    // Internal State
    this.evseState = 1; // Default to Disconnected
    this.isCharging = false;
    this.watts = 0;
    this.amps = 0;

    // 1. Outlet Service (The Main Tile) - Read-only status indicator
    // On = Connected/Charging, Off = Disconnected
    this.outletService = new Service.Outlet(this.name);
    this.outletService.setPrimaryService(true);
    
    // 2. Power Sensor (LightSensor hack for watts)
    this.powerService = new Service.LightSensor(this.name + ' Power');
    this.outletService.addLinkedService(this.powerService);

    // 3. Accessory Info
    this.infoService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'OpenEVSE')
      .setCharacteristic(Characteristic.Model, 'WiFi v5.1.5')
      .setCharacteristic(Characteristic.SerialNumber, this.host || 'Unknown');

    // Initial Setup
    this.initMQTT();
    
    // Initial HTTP Fetch & Poll Setup
    if (this.host) {
      this.fetchStatus();
      this.pollInterval = setInterval(() => this.fetchStatus(), 30000);
    } else {
      this.log.warn('No "host" configured. HTTP polling disabled.');
    }
  }

  /**
   * HTTP Polling Fallback
   */
  fetchStatus() {
    const url = `http://${this.host}/status`;
    
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const status = JSON.parse(data);
          this.log.debug(`HTTP Status received from ${this.host}`);
          
          this.processUpdate({
            state: status.state,
            watt: status.watt,
            amp: status.amp
          });
        } catch (e) {
          this.log.error(`Error parsing HTTP response from ${this.host}: ${e.message}`);
        }
      });
    }).on('error', (err) => {
      this.log.error(`HTTP Polling Error to ${this.host}: ${err.message}`);
    });
  }

  initMQTT() {
    if (!this.config.mqtt_host) {
      this.log.warn('No "mqtt_host" configured. MQTT disabled.');
      return;
    }

    const broker = `mqtt://${this.config.mqtt_host}:${this.config.mqtt_port || 1883}`;
    const options = {
      reconnectPeriod: 5000, // Try reconnecting every 5s
    };
    
    if (this.config.mqtt_user) {
      options.username = this.config.mqtt_user;
      options.password = this.config.mqtt_pass;
    }

    this.log(`Connecting to MQTT: ${broker}`);
    this.client = mqtt.connect(broker, options);

    this.client.on('connect', () => {
      this.log('MQTT Connected');
      this.client.subscribe(`${this.baseTopic}/state`);
      this.client.subscribe(`${this.baseTopic}/amp`);
      this.client.subscribe(`${this.baseTopic}/watt`);
    });

    this.client.on('message', (topic, message) => {
      const value = message.toString();
      const payload = {};

      if (topic.endsWith('/state')) {
        payload.state = parseInt(value);
      } else if (topic.endsWith('/amp')) {
        payload.amp = parseFloat(value);
      } else if (topic.endsWith('/watt')) {
        payload.watt = parseInt(value);
      }

      this.processUpdate(payload);
    });

    this.client.on('error', (err) => {
      this.log.error(`MQTT Error: ${err.message}`);
    });

    this.client.on('offline', () => {
      this.log.warn('MQTT client went offline. Retrying...');
    });

    this.client.on('reconnect', () => {
      this.log('MQTT attempting to reconnect...');
    });
  }

  /**
   * Unified Processor for state updates from MQTT or HTTP
   */
  processUpdate(data) {
    let updated = false;

    // Update EVSE State
    if (data.state !== undefined) {
      this.evseState = data.state;
      // States: 1=Disconnected, 2=Connected, 3=Charging, 4=Ventilation Required, 254=Sleeping, 255=Error
      // Outlet On = Connected (2), Charging (3), or Ventilation Required (4)
      // Outlet Off = Disconnected (1), Sleeping (254), or Error (255)
      const wasCharging = this.isCharging;
      this.isCharging = (this.evseState === 3 || this.evseState === 4);
      updated = true;
    }

    // Update Watts (LightSensor hack)
    if (data.watt !== undefined) {
      this.watts = data.watt;
      this.powerService.updateCharacteristic(
        Characteristic.CurrentAmbientLightLevel, 
        Math.max(0.0001, this.watts)
      );
    }

    // Update Amps
    if (data.amp !== undefined) {
      this.amps = data.amp;
    }

    if (updated) {
      this.updateHomeKit();
    }
  }

  updateHomeKit() {
    // Map EVSE state to HomeKit Outlet On/Off
    // Outlet On = Connected/Charging (states 2, 3, 4)
    // Outlet Off = Disconnected/Error (states 1, 254, 255)
    const isOutletOn = (this.evseState === 2 || this.evseState === 3 || this.evseState === 4);
    
    this.outletService.updateCharacteristic(Characteristic.On, isOutletOn);
    
    // Update InUse characteristic (true when actively charging, i.e., state 3 or 4)
    this.outletService.updateCharacteristic(Characteristic.InUse, this.isCharging);
    
    // Update OutletInUse for error indication
    this.outletService.updateCharacteristic(
      Characteristic.OutletInUse,
      (this.evseState === 255) ? true : false
    );
  }

  getServices() {
    return [this.infoService, this.outletService, this.powerService];
  }
}
