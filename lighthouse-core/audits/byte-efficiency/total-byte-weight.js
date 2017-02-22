/**
 * @license
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
 /**
  * @fileoverview
  */
'use strict';

const Audit = require('./byte-efficiency-audit');
const URL = require('../../lib/url-shim');

// ~95th percentile http://httparchive.org/interesting.php?a=All&l=Feb%201%202017&s=All#bytesTotal
const FAILURE_THRESHOLD_IN_BYTES = 5 * 1024 * 1024; // 5MB

class TotalByteWeight extends Audit {
  /**
   * @return {!AuditMeta}
   */
  static get meta() {
    return {
      category: 'Network',
      name: 'total-byte-weight',
      description: 'Avoids enormous network payloads',
      helpText:
          'Network transfer size is [highly correlated](http://httparchive.org/interesting.php?a=All&l=Feb%201%202017&s=All#onLoad) with long load times. ' +
          'Try to find ways to reduce the size of required files.',
      requiredArtifacts: ['networkRecords']
    };
  }

  /**
   * @param {!Artifacts} artifacts
   * @param {!Array<WebInspector.NetworkRequest>} networkRecords
   * @return {{results: !Array<Object>, tableHeadings: Object,
   *     passes: boolean=, debugString: string=}}
   */
  static audit_(artifacts, networkRecords) {
    let totalBytes = 0;
    const results = networkRecords.reduce((prev, record) => {
      // exclude data URIs since their size is reflected in other resources
      if (record.scheme === 'data') {
        return prev;
      }

      const result = {
        url: URL.getDisplayName(record.url),
        wastedBytes: 0,
        totalBytes: record.transferSize,
      };

      totalBytes += result.totalBytes;
      prev.push(result);
      return prev;
    }, []).sort((itemA, itemB) => itemB.totalBytes - itemA.totalBytes).slice(0, 10);

    return {
      displayValue: `Total size was ${Audit.bytesToKbString(totalBytes)}`,
      passes: totalBytes < FAILURE_THRESHOLD_IN_BYTES,
      results,
      tableHeadings: {
        url: 'URL',
        totalKb: 'Total Size',
        totalMs: 'Transfer Time',
      }
    };
  }
}

module.exports = TotalByteWeight;
