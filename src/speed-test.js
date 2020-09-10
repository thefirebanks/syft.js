import { createRandomBuffer } from './utils/random-buffer';

/**
 * SpeedTest is a class that contains the necessary components
 * to measure download/upload speed, and ping.
 */
export class SpeedTest {
  /**
   * @param {string} downloadUrl
   * @param {string} uploadUrl
   * @param {string} pingUrl
   * @param {number} maxUploadSizeMb
   * @param {number} maxTestTimeSec
   */
  constructor({
    downloadUrl,
    uploadUrl,
    pingUrl,
    maxUploadSizeMb = 64,
    maxTestTimeSec = 10,
  }) {
    this.downloadUrl = downloadUrl;
    this.uploadUrl = uploadUrl;
    this.pingUrl = pingUrl;
    this.maxUploadSizeMb = maxUploadSizeMb;
    this.maxTestTimeSec = maxTestTimeSec;

    // Various settings to tune.
    this.bwAvgWindow = 5;
    this.bwLowJitterThreshold = 0.05;
    this.bwMaxLowJitterConsecutiveMeasures = 5;
  }

  /**
   * Measures the time taken to make an XMLHttpRequest (xhr).
   * Gets called before the request is sent, to set up values and tools to measure time.
   * Returns a promise that gets updated when the request is sent and a response is received with no errors.
   *  If the request is successful, then the value of the promise is the time that the request took (in seconds)
   *  Else, the value is an Error
   * @param {XMLHttpRequest} xhr - XMLHttpRequest
   * @param {boolean} isUpload
   */
  async meterXhr(xhr, isUpload = false) {
    return new Promise((resolve, reject) => {
      // Set up the initial values to measure time
      let timeoutHandler = null,
        prevTime = 0,
        prevSize = 0,
        avgCollector = new AvgCollector({
          avgWindow: this.bwAvgWindow,
          lowJitterThreshold: this.bwLowJitterThreshold,
          maxLowJitterConsecutiveMeasures: this
            .bwMaxLowJitterConsecutiveMeasures,
        });

      const req = isUpload ? xhr.upload : xhr;

      // Update the value of the promise when the request is finished
      const finish = (error = null) => {
        if (timeoutHandler) {
          clearTimeout(timeoutHandler);
        }

        // Clean up
        req.onprogress = null;
        req.onload = null;
        req.onerror = null;
        xhr.abort();

        // Return result
        if (!error) {
          resolve(avgCollector.getAvg());
        } else {
          reject(new Error(error));
        }
      };

      req.onreadystatechange = () => {
        if (xhr.readyState === 1) {
          // As soon as connection is opened, set speed test timeout
          timeoutHandler = setTimeout(finish, this.maxTestTimeSec * 1000);
          // Set initial time/size values
          if (!prevTime) {
            prevTime = Date.now() / 1000;
            prevSize = 0;
          }
        }
      };

      req.onprogress = (e) => {
        const // mbit
          size = (8 * e.loaded) / 1048576,
          // seconds
          time = Date.now() / 1000;

        if (!prevTime) {
          prevTime = time;
          prevSize = size;
          return;
        }

        // Update change in time and size as the request i in progress
        let deltaSize = size - prevSize,
          deltaTime = time - prevTime,
          speed = deltaSize / deltaTime;

        if (deltaTime === 0 || !Number.isFinite(speed)) {
          // Cap to 1Gbps
          speed = 1000;
        }

        const canStop = avgCollector.collect(speed);
        if (canStop) {
          finish();
        }

        prevSize = size;
        prevTime = time;
      };

      req.onload = () => {
        finish();
      };
      req.onerror = (e) => {
        finish(e);
      };
    });
  }

  async getDownloadSpeed() {
    let xhr = new XMLHttpRequest();
    const result = this.meterXhr(xhr);

    xhr.open('GET', this.downloadUrl + '?' + Math.random(), true);
    xhr.send();

    return result;
  }

  async getUploadSpeed() {
    const xhr = new XMLHttpRequest();
    const result = this.meterXhr(xhr, true);
    const buff = await createRandomBuffer(this.maxUploadSizeMb * 1024 * 1024);

    xhr.open('POST', this.uploadUrl, true);
    xhr.send(buff);

    return result;
  }

  async getPing() {
    return new Promise((resolve, reject) => {
      // Set up values to measure ping
      const avgCollector = new AvgCollector({});
      let currXhr;
      let timeoutHandler;

      // Update value of promise once test is finished
      const finish = (xhr, error = null) => {
        if (timeoutHandler) {
          clearTimeout(timeoutHandler);
        }

        // Clean up
        xhr.onprogress = null;
        xhr.onload = null;
        xhr.onerror = null;
        xhr.abort();

        // Return result
        if (!error) {
          resolve(avgCollector.getAvg());
        } else {
          reject(new Error(error));
        }
      };

      const runPing = () => {
        const xhr = new XMLHttpRequest();
        currXhr = xhr;
        let startTime = Date.now();

        xhr.onload = () => {
          const ping = Date.now() - startTime;
          const canStop = avgCollector.collect(ping);
          if (canStop) {
            finish(xhr);
          } else {
            setTimeout(runPing, 0);
          }
        };

        xhr.onerror = (e) => {
          finish(xhr, e);
        };

        xhr.open('GET', this.pingUrl + '?' + Math.random(), true);
        xhr.send();
      };

      timeoutHandler = setTimeout(() => {
        finish(currXhr);
      }, this.maxTestTimeSec * 1000);
      runPing();
    });
  }
}

/**
 * Helper to average series of values.
 *
 * @private
 * @param options {Object}
 * @param options.avgWindow {number} Window to average (last N measurements)
 * @param options.lowJitterThreshold {number} Change of avg considered stable
 * @param maxLowJitterConsecutiveMeasures {number} Number of measures
 *  when avg stays stable to stop collecting more samples
 */
class AvgCollector {
  constructor({
    avgWindow = 5,
    lowJitterThreshold = 0.05,
    maxLowJitterConsecutiveMeasures = 5,
  }) {
    this.measuresCount = 0;
    this.prevAvg = 0;
    this.avg = 0;
    this.lowJitterConsecutiveMeasures = 0;

    this.avgWindow = avgWindow;
    this.lowJitterThreshold = lowJitterThreshold;
    this.maxLowJitterConsecutiveMeasures = maxLowJitterConsecutiveMeasures;
    this.name = name;
  }

  /**
   * Collects one sample for averaging.
   * @param value {number} Reported speed
   * @returns {boolean} Can stop collecting due to average value stability
   */
  collect(value) {
    this.prevAvg = this.avg;
    const avgWindow = Math.min(this.measuresCount, this.avgWindow);
    this.avg = (this.avg * avgWindow + value) / (avgWindow + 1);
    this.measuresCount++;

    // Return true if measurements are stable.
    if (
      this.prevAvg > 0 &&
      this.avg < this.prevAvg * (1 + this.lowJitterThreshold) &&
      this.avg > this.prevAvg * (1 - this.lowJitterThreshold)
    ) {
      this.lowJitterConsecutiveMeasures++;
    } else {
      this.lowJitterConsecutiveMeasures = 0;
    }

    return (
      this.lowJitterConsecutiveMeasures >= this.maxLowJitterConsecutiveMeasures
    );
  }

  getAvg() {
    return this.avg;
  }
}
