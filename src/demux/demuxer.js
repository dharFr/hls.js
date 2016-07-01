import Event from '../events';
import DemuxerInline from '../demux/demuxer-inline';
// import DemuxerWorker from '../demux/demuxer-worker';
import {logger} from '../utils/logger';
import Decrypter from '../crypt/decrypter';

class Demuxer {

  constructor(hls, id) {
    this.hls = hls;
    this.id = id;
    var typeSupported = {
      mp4 : MediaSource.isTypeSupported('video/mp4'),
      mp2t : hls.config.enableMP2TPassThrough && MediaSource.isTypeSupported('video/mp2t')
    };
    if (hls.config.enableWorker && (typeof(Worker) !== 'undefined')) {
        logger.log('demuxing in webworker');
        try {
          debugger
          var DemuxerWorker = require("worker!../demux/demuxer-worker");
          this.w = new DemuxerWorker();
          this.onwmsg = this.onWorkerMessage.bind(this);
          this.w.addEventListener('message', this.onwmsg);
          this.w.postMessage({cmd: 'init', typeSupported : typeSupported, id : id, config: JSON.stringify(hls.config)});
        } catch(err) {
          logger.error('error while initializing DemuxerWorker, fallback on DemuxerInline');
          this.demuxer = new DemuxerInline(hls,id,typeSupported);
        }
      } else {
        this.demuxer = new DemuxerInline(hls,id,typeSupported);
      }
      this.demuxInitialized = true;
  }

  destroy() {
    if (this.w) {
      this.w.removeEventListener('message', this.onwmsg);
      this.w.terminate();
      this.w = null;
    } else {
      this.demuxer.destroy();
      this.demuxer = null;
    }
    if (this.decrypter) {
      this.decrypter.destroy();
      this.decrypter = null;
    }
  }

  pushDecrypted(data, audioCodec, videoCodec, timeOffset, cc, level, sn, duration) {
    if (this.w) {
      // post fragment payload as transferable objects (no copy)
      this.w.postMessage({cmd: 'demux', data: data, audioCodec: audioCodec, videoCodec: videoCodec, timeOffset: timeOffset, cc: cc, level: level, sn : sn, duration: duration}, [data]);
    } else {
      this.demuxer.push(new Uint8Array(data), audioCodec, videoCodec, timeOffset, cc, level, sn, duration);
    }
  }

  push(data, audioCodec, videoCodec, timeOffset, cc, level, sn, duration, decryptdata) {
    if ((data.byteLength > 0) && (decryptdata != null) && (decryptdata.key != null) && (decryptdata.method === 'AES-128')) {
      if (this.decrypter == null) {
        this.decrypter = new Decrypter(this.hls);
      }

      var localthis = this;
      this.decrypter.decrypt(data, decryptdata.key, decryptdata.iv, function(decryptedData){
        localthis.pushDecrypted(decryptedData, audioCodec, videoCodec, timeOffset, cc, level, sn, duration);
      });
    } else {
      this.pushDecrypted(data, audioCodec, videoCodec, timeOffset, cc, level, sn, duration);
    }
  }

  onWorkerMessage(ev) {
    let data = ev.data,
        hls = this.hls,
        id = data.id,
        level = data.level,
        sn = data.sn;

    //console.log('onWorkerMessage:' + data.event);
    switch(data.event) {
      case Event.FRAG_PARSING_INIT_SEGMENT:
        hls.trigger(Event.FRAG_PARSING_INIT_SEGMENT, {id : id, level : level, sn : sn, tracks : data.tracks, unique : data.unique});
        break;
      case Event.FRAG_PARSING_DATA:
        hls.trigger(Event.FRAG_PARSING_DATA,{
          id : id,
          level : level,
          sn : sn,
          data1: new Uint8Array(data.data1),
          data2: new Uint8Array(data.data2),
          startPTS: data.startPTS,
          endPTS: data.endPTS,
          startDTS: data.startDTS,
          endDTS: data.endDTS,
          type: data.type,
          nb: data.nb
        });
        break;
        case Event.FRAG_PARSING_METADATA:
        hls.trigger(Event.FRAG_PARSING_METADATA, {
          id : id,
          level : level,
          sn : sn,
          samples: data.samples
        });
        break;
        case Event.FRAG_PARSING_USERDATA:
        hls.trigger(Event.FRAG_PARSING_USERDATA, {
          id : id,
          level : level,
          sn : sn,
          samples: data.samples
        });
        break;
      default:
        hls.trigger(data.event, data.data);
        break;
    }
  }
}

export default Demuxer;

