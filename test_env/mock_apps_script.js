class MockPropertiesService {
  constructor() {
    this.props = {};
  }
  getProperty(key) { return this.props[key] || null; }
  setProperty(key, value) { this.props[key] = String(value); }
  getProperties() { return this.props; }
}

const propertiesService = new MockPropertiesService();

global.PropertiesService = {
  getScriptProperties: () => propertiesService
};

global.Logger = {
  log: (msg) => console.log('[Logger]', msg)
};

global.Utilities = {
  sleep: (ms) => { /* mock sleep */ }
};

global.ScriptApp = {
  getOAuthToken: () => 'mock_token'
};

global.UrlFetchApp = {
  fetch: (url, options) => {
    console.log(`[UrlFetchApp.fetch] ${options.method} ${url}`);
    
    // Mock Account ID
    if (url.includes('mybusinessaccountmanagement')) {
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ accounts: [{ name: 'accounts/123' }] })
      };
    }
    
    // Mock Reviews
    if (url.includes('/reviews') && options.method === 'get') {
      if (url.includes('pageToken=PAGE2')) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({
            reviews: [
              { reviewId: 'R5_UNREPLIED_ON_PAGE2', name: 'accounts/123/locations/456/reviews/R5', starRating: 'FIVE', comment: 'Unreplied on page 2' }
            ],
            nextPageToken: global.SIMULATE_INFINITE_LOOP ? 'PAGE2' : null
          })
        };
      }
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          reviews: [
            { reviewId: 'R1_REPLIED', name: 'accounts/123/locations/456/reviews/R1', starRating: 'FIVE', comment: 'Great!', reviewReply: { comment: 'Thanks' } },
            { reviewId: 'R2', name: 'accounts/123/locations/456/reviews/R2', starRating: 'ONE', comment: 'Bad' },
            { reviewId: 'R3', name: 'accounts/123/locations/456/reviews/R3', starRating: 'FIVE', comment: 'Awesome' },
            { reviewId: 'R4', name: 'accounts/123/locations/456/reviews/R4', starRating: 'FIVE', comment: 'Super' },
          ],
          nextPageToken: 'PAGE2'
        })
      };
    }
    
    // Mock Gemini
    if (url.includes('generativelanguage')) {
      if (global.SIMULATE_GEMINI_ERROR) {
        return {
          getResponseCode: () => global.SIMULATE_GEMINI_ERROR,
          getContentText: () => JSON.stringify({ error: { message: "Quota Exceeded" } })
        };
      }
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Thank you for the review!' }] } }]
        })
      };
    }
    
    // Mock GBP Reply
    if (url.includes('/reply')) {
      return {
        getResponseCode: () => 200,
        getContentText: () => '{}'
      };
    }
    
    return {
      getResponseCode: () => 500,
      getContentText: () => 'Not implemented in mock'
    };
  }
};

module.exports = {
  setup: (config) => {
    propertiesService.props = config || {};
  },
  getProps: () => propertiesService.props
};
