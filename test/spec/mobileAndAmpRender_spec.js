import { renderAmpOrMobileAd } from 'src/mobileAndAmpRender';
import * as postscribeRender from 'src/adHtmlRender'
import * as utils from 'src/utils';
import { expect } from 'chai';
import { mocks } from 'test/helpers/mocks';
import { merge } from 'lodash';
import {writeAdHtml} from 'src/adHtmlRender';

import { createMraid2Mock, createMraid3Mock } from 'test/helpers/mraid-mocks';

function renderingMocks() {
  return {
    messages: [],
    getWindowObject: function () {
      return {
        document: {
          body: {
            appendChild: sinon.spy(),
          },
          createComment: () => true,
        },
        parent: {
          postMessage: sinon.spy(),
          $$PREBID_GLOBAL$$: {
            renderAd: sinon.spy(),
          },
        },
        postMessage: (message, domain) => {
          this.messages[0](message);
        },
        top: null,
        $sf: {
          ext: {
            register: sinon.spy(),
            expand: sinon.spy(),
          },
        },
        addEventListener: (type, listener, capture) => {
          this.messages.push(listener);
        },
        innerWidth: 300,
        innerHeight: 250,
      };
    },
  };
}

describe("renderingManager", function () {
  let xhr;
  let requests;

  before(function () {
    xhr = sinon.useFakeXMLHttpRequest();
    xhr.onCreate = (request) => requests.push(request);
  });

  beforeEach(function () {
    requests = [];
  });

  after(function () {
    xhr.restore();
  });

  describe("mobile creative", function () {
    let writeHtmlSpy;
    let sendRequestSpy;
    let triggerPixelSpy;
    let mockWin;

    before(function () {
      writeHtmlSpy = sinon.spy(postscribeRender, "writeAdHtml");
      sendRequestSpy = sinon.spy(utils, "sendRequest");
      triggerPixelSpy = sinon.spy(utils, "triggerPixel");
      mockWin = merge(
        mocks.createFakeWindow("http://example.com"),
        renderingMocks().getWindowObject()
      );
    });

    afterEach(function () {
      writeHtmlSpy.resetHistory();
      sendRequestSpy.resetHistory();
      triggerPixelSpy.resetHistory();
    });

    after(function () {
      writeHtmlSpy.restore();
      sendRequestSpy.restore();
      triggerPixelSpy.restore();
    });

    it("should render mobile app creative", function () {
      let ucTagData = {
        cacheHost: "example.com",
        cachePath: "/path",
        uuid: "123",
        size: "300x250",
      };

      renderAmpOrMobileAd(ucTagData, true);

      let response = {
        width: 300,
        height: 250,
        crid: 123,
        adm: "ad-markup",
        wurl: "https://test.prebidcache.wurl",
      };
      requests[0].respond(200, {}, JSON.stringify(response));
      expect(writeHtmlSpy.callCount).to.equal(1);
      expect(sendRequestSpy.args[0][0]).to.equal(
        "https://example.com/path?uuid=123"
      );
    });

    it("should render mobile app creative with missing cache wurl", function () {
      let ucTagData = {
        cacheHost: "example.com",
        cachePath: "/path",
        uuid: "123",
        size: "300x250",
      };

      renderAmpOrMobileAd(ucTagData, true);

      let response = {
        width: 300,
        height: 250,
        crid: 123,
        adm: "ad-markup",
      };
      requests[0].respond(200, {}, JSON.stringify(response));
      expect(writeHtmlSpy.callCount).to.equal(1);
      expect(sendRequestSpy.args[0][0]).to.equal(
        "https://example.com/path?uuid=123"
      );
    });

    it("should render mobile app creative using default cacheHost and cachePath", function () {
      let ucTagData = {
        uuid: "123",
        size: "300x250",
      };
      renderAmpOrMobileAd(ucTagData, true);

      let response = {
        width: 300,
        height: 250,
        crid: 123,
        adm: "ad-markup",
        // Immediate write of html happens only if burl is present.
        // Without burl ad markup write waits until MRAID-visible.
        burl: 'https://127.0.0.1/burl'
      };
      requests[0].respond(200, {}, JSON.stringify(response));
      expect(writeHtmlSpy.callCount).to.equal(1);
      expect(sendRequestSpy.args[0][0]).to.equal(
        "https://prebid.adnxs.com/pbc/v1/cache?uuid=123"
      );
    });

    describe("bids without burl", () => {
      const ucTagData = {
        cacheHost: "example.com",
        cachePath: "/path",
        uuid: "123",
        size: "300x250",
        env: "mobile-app",
        hb_cache_region: "us-east-1"
      };

      const response = {
        width: 300,
        height: 250,
        crid: 123,
        adm: "ad-markup",
        // No billing url "burl" property.
      };

      let mraidMock;
      let loadScriptStub;
      beforeEach(() => {
        loadScriptStub = sinon.stub(utils, "loadScript");
      });
      afterEach(() => {
        if (loadScriptStub.restore) {
          loadScriptStub.restore();
        }
        if (mraidMock) {
          mraidMock.cleanup();
        }
      });

      describe('MRAID 2 - not initially ready, not visible until later', () => {
        it('should writeHtml only after MRAID visible', function () {
          renderAmpOrMobileAd(ucTagData, true);

          requests[0].respond(200, {}, JSON.stringify(response));
          expect(writeHtmlSpy.callCount).to.equal(0);

          // Simulate mraid.js being loaded.
          expect(loadScriptStub.callCount).to.equal(1);

          let loadMraidScriptCallback = loadScriptStub.getCall(0).args[2];

          mraidMock = createMraid2Mock({isReady: false, isViewable: false});

          // Not ready at time of script load callback.
          loadMraidScriptCallback();

          // Now ready, but not yet visible.
          mraidMock.setReady(true);

          expect(writeHtmlSpy.callCount).to.equal(0);

          // Now make it visible.
          mraidMock.setViewable(true);

          expect(writeHtmlSpy.callCount).to.equal(1);
        });
      });

      describe('MRAID 2 - not initially ready, visible when ready', () => {
        it('should writeHtml only after MRAID visible happens', function () {
          renderAmpOrMobileAd(ucTagData, true);

          requests[0].respond(200, {}, JSON.stringify(response));
          expect(writeHtmlSpy.callCount).to.equal(0);

          // Simulate mraid.js being loaded.
          expect(loadScriptStub.callCount).to.equal(1);

          let loadMraidScriptCallback = loadScriptStub.getCall(0).args[2];

          mraidMock = createMraid2Mock({isReady: false, isViewable: false});

          // Not ready at time of script load callback.
          loadMraidScriptCallback();

          expect(writeHtmlSpy.callCount).to.equal(0);

          mraidMock.setViewable(true);

          // Ready and visible.
          mraidMock.setReady(true);

          expect(writeHtmlSpy.callCount).to.equal(1);
        });
      });

      describe('MRAID 2 - initially ready, not visible until later', () => {
        it('should writeHtml only after MRAID visible', function () {
          renderAmpOrMobileAd(ucTagData, true);

          requests[0].respond(200, {}, JSON.stringify(response));
          expect(writeHtmlSpy.callCount).to.equal(0);

          // Simulate mraid.js being loaded.
          expect(loadScriptStub.callCount).to.equal(1);

          let loadMraidScriptCallback = loadScriptStub.getCall(0).args[2];

          mraidMock = createMraid2Mock({isReady: false, isViewable: false});

          mraidMock.setReady(true);

          // Ready initially, but not yet visible.
          loadMraidScriptCallback();

          expect(writeHtmlSpy.callCount).to.equal(0);

          // Now make it visible.
          mraidMock.setViewable(true);

          expect(writeHtmlSpy.callCount).to.equal(1);
        });
      });

      describe('MRAID 2 - initially ready and visible', () => {
        it('should writeHtml only after MRAID visible', function () {
          renderAmpOrMobileAd(ucTagData, true);

          requests[0].respond(200, {}, JSON.stringify(response));
          expect(writeHtmlSpy.callCount).to.equal(0);

          // Simulate mraid.js being loaded.
          expect(loadScriptStub.callCount).to.equal(1);

          let loadMraidScriptCallback = loadScriptStub.getCall(0).args[2];

          mraidMock = createMraid2Mock({isReady: false, isViewable: false});

          expect(writeHtmlSpy.callCount).to.equal(0);

          mraidMock.setViewable(true);
          mraidMock.setReady(true);

          // Ready and visible at the time of script load callback.
          loadMraidScriptCallback();

          expect(writeHtmlSpy.callCount).to.equal(1);
        });
      });

      describe('MRAID 3 - not initially ready, not visible until later', () => {
        it('should writeHtml only after MRAID visible', function () {
          renderAmpOrMobileAd(ucTagData, true);

          requests[0].respond(200, {}, JSON.stringify(response));
          expect(writeHtmlSpy.callCount).to.equal(0);

          // Simulate mraid.js being loaded.
          expect(loadScriptStub.callCount).to.equal(1);

          let loadMraidScriptCallback = loadScriptStub.getCall(0).args[2];

          mraidMock = createMraid3Mock({isReady: false, isViewable: false});

          // Not ready at time of script load callback.
          loadMraidScriptCallback();

          // Now ready, but not yet visible.
          mraidMock.setReady(true);

          expect(writeHtmlSpy.callCount).to.equal(0);

          // Now make it visible.
          mraidMock.setViewable(true);

          expect(writeHtmlSpy.callCount).to.equal(1);
        });
      });

      describe('MRAID 3 - not initially ready, visible when ready', () => {
        it('should writeHtml only after MRAID visible', function () {
          renderAmpOrMobileAd(ucTagData, true);

          requests[0].respond(200, {}, JSON.stringify(response));
          expect(writeHtmlSpy.callCount).to.equal(0);

          // Simulate mraid.js being loaded.
          expect(loadScriptStub.callCount).to.equal(1);

          let loadMraidScriptCallback = loadScriptStub.getCall(0).args[2];

          mraidMock = createMraid3Mock({isReady: false, isViewable: false});

          // Not ready at time of script load callback.
          loadMraidScriptCallback();

          expect(writeHtmlSpy.callCount).to.equal(0);

          mraidMock.setViewable(true);

          // Ready and visible.
          mraidMock.setReady(true);

          expect(writeHtmlSpy.callCount).to.equal(1);
        });
      });

      describe('MRAID 3 - initially ready, not visible', () => {
        it('should writeHtml only after MRAID visible', function () {
          renderAmpOrMobileAd(ucTagData, true);

          requests[0].respond(200, {}, JSON.stringify(response));
          expect(writeHtmlSpy.callCount).to.equal(0);

          // Simulate mraid.js being loaded.
          expect(loadScriptStub.callCount).to.equal(1);

          let loadMraidScriptCallback = loadScriptStub.getCall(0).args[2];

          mraidMock = createMraid3Mock({isReady: false, isViewable: false});

          mraidMock.setReady(true);

          // Ready initially, but not yet visible.
          loadMraidScriptCallback();

          expect(writeHtmlSpy.callCount).to.equal(0);

          // Now make it visible.
          mraidMock.setViewable(true);

          expect(writeHtmlSpy.callCount).to.equal(1);
        });
      });

      describe('MRAID 3 - initially ready and visible', () => {
        it('should writeHtml only after MRAID visible', function () {
          renderAmpOrMobileAd(ucTagData, true);

          requests[0].respond(200, {}, JSON.stringify(response));
          expect(writeHtmlSpy.callCount).to.equal(0);

          // Simulate mraid.js being loaded.
          expect(loadScriptStub.callCount).to.equal(1);

          let loadMraidScriptCallback = loadScriptStub.getCall(0).args[2];

          mraidMock = createMraid3Mock({isReady: false, isViewable: false});

          expect(writeHtmlSpy.callCount).to.equal(0);

          mraidMock.setViewable(true);
          mraidMock.setReady(true);

          // Ready and visible at the time of script load callback.
          loadMraidScriptCallback();

          expect(writeHtmlSpy.callCount).to.equal(1);
        });
      });
    });

  //   it('should catch errors from creative', function (done) {
  //     window.addEventListener('error', e => {
  //       done(e.error);
  //     });

  //     const consoleErrorSpy = sinon.spy(console, 'error');

  //     let ucTagData = {
  //       cacheHost: 'example.com',
  //       cachePath: '/path',
  //       uuid: '123',
  //       size: '300x250'
  //     };

  //     renderAmpOrMobileAd(ucTagData, true);

  //     let response = {
  //       width: 300,
  //       height: 250,
  //       crid: 123,
  //       adm: '<script src="notExistingScript.js"></script>'
  //     };
  //     requests[0].respond(200, {}, JSON.stringify(response));

  //     setTimeout(() => {
  //       expect(consoleErrorSpy.callCount).to.equal(1);
  //       done();
  //     }, 10);
  //   });
  });

  describe("amp creative", function () {
    let writeHtmlSpy;
    let sendRequestSpy;
    let triggerPixelSpy;
    let mockWin;

    before(function () {
      writeHtmlSpy = sinon.spy(postscribeRender, "writeAdHtml");
      sendRequestSpy = sinon.spy(utils, "sendRequest");
      triggerPixelSpy = sinon.spy(utils, "triggerPixel");
      mockWin = merge(
        mocks.createFakeWindow("http://example.com"),
        renderingMocks().getWindowObject()
      );
    });

    afterEach(function () {
      writeHtmlSpy.resetHistory();
      sendRequestSpy.resetHistory();
      triggerPixelSpy.resetHistory();
    });

    after(function () {
      writeHtmlSpy.restore();
      sendRequestSpy.restore();
      triggerPixelSpy.restore();
    });

    it("should render amp creative", function () {
      let ucTagData = {
        cacheHost: "example.com",
        cachePath: "/path",
        uuid: "123",
        size: "300x250",
        hbPb: "10.00",
      };

      renderAmpOrMobileAd(ucTagData);

      let response = {
        width: 300,
        height: 250,
        crid: 123,
        adm: "ad-markup${AUCTION_PRICE}",
        wurl: "https://test.prebidcache.wurl",
      };
      requests[0].respond(200, {}, JSON.stringify(response));
      expect(writeHtmlSpy.args[0][0]).to.equal(
        "<!--Creative 123 served by Prebid.js Header Bidding-->ad-markup10.00"
      );
      expect(sendRequestSpy.args[0][0]).to.equal(
        "https://example.com/path?uuid=123"
      );
      expect(triggerPixelSpy.args[0][0]).to.equal(
        "https://test.prebidcache.wurl"
      );
    });

    it("should replace AUCTION_PRICE with response.price over hbPb", function () {
      let ucTagData = {
        cacheHost: "example.com",
        cachePath: "/path",
        uuid: "123",
        size: "300x250",
        hbPb: "10.00",
      };

      renderAmpOrMobileAd(ucTagData);

      let response = {
        width: 300,
        height: 250,
        crid: 123,
        price: 12.5,
        adm: "ad-markup${AUCTION_PRICE}",
        wurl: "https://test.prebidcache.wurl",
      };
      requests[0].respond(200, {}, JSON.stringify(response));
      expect(writeHtmlSpy.args[0][0]).to.equal(
        "<!--Creative 123 served by Prebid.js Header Bidding-->ad-markup12.5"
      );
      expect(sendRequestSpy.args[0][0]).to.equal(
        "https://example.com/path?uuid=123"
      );
      expect(triggerPixelSpy.args[0][0]).to.equal(
        "https://test.prebidcache.wurl"
      );
    });

    it("should replace AUCTION_PRICE with with empty value when neither price nor hbPb exist", function () {
      let ucTagData = {
        cacheHost: "example.com",
        cachePath: "/path",
        uuid: "123",
        size: "300x250",
      };

      renderAmpOrMobileAd(ucTagData);

      let response = {
        width: 300,
        height: 250,
        crid: 123,
        adm: "ad-markup${AUCTION_PRICE}",
        wurl: "https://test.prebidcache.wurl",
      };
      requests[0].respond(200, {}, JSON.stringify(response));
      expect(writeHtmlSpy.args[0][0]).to.equal(
        "<!--Creative 123 served by Prebid.js Header Bidding-->ad-markup"
      );
      expect(sendRequestSpy.args[0][0]).to.equal(
        "https://example.com/path?uuid=123"
      );
      expect(triggerPixelSpy.args[0][0]).to.equal(
        "https://test.prebidcache.wurl"
      );
    });
  });
});

describe('writeAdHtml', () => {
  it('removes DOCTYPE from markup', () => {
    const ps = sinon.stub();
    writeAdHtml('<!DOCTYPE html><div>mock-ad</div>', ps);
    sinon.assert.calledWith(ps, sinon.match.any, '<div>mock-ad</div>')
  });

  it('removes lowercase doctype from markup', () => {
    const ps = sinon.stub();
    writeAdHtml('<!doctype html><div>mock-ad</div>', ps);
    sinon.assert.calledWith(ps, sinon.match.any, '<div>mock-ad</div>')
  });
})
