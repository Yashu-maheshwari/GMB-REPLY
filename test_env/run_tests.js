const mock = require('./mock_apps_script.js');
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync('../Code.gs', 'utf8');
vm.runInThisContext(code);

function runTest(testName, setupFn) {
  console.log(`\n==== RUNNING TEST: ${testName} ====`);
  const initialConfig = {
    MULTI_LOCATION_CONFIG: JSON.stringify([{
      locationPath: "locations/123", businessName: "TestBiz", businessType: "Store", seoKeywords: ["test"], supportNumber: "123"
    }]),
    GEMINI_API_KEY: 'test-key',
    GEMINI_MODEL: 'gemini-1.5-flash'
  };
  mock.setup(initialConfig);
  if (setupFn) setupFn(mock.getProps());
  checkNewReviews();
  return mock.getProps();
}

// TEST 1: Dry Run Mode
runTest('Dry Run Mode', props => {
  props['GMB_REPLY_DRY_RUN'] = 'true';
});

// TEST 2: First failure -> attemptCount 1
runTest('First failure -> attemptCount 1', props => {
  global.SIMULATE_GEMINI_ERROR = 429;
});

// TEST 3: Max 3 Calls Enforced
runTest('Max 3 Calls Enforced', props => {
  global.SIMULATE_GEMINI_ERROR = false;
});

// TEST 4: Cooldown prevents retry
runTest('Cooldown Prevents Retry', props => {
  props['GEMINI_COOLDOWN_UNTIL'] = (Date.now() + 60000).toString();
});

// TEST 5: DEAD state prevents retry
runTest('DEAD state prevents retry', props => {
  global.SIMULATE_GEMINI_ERROR = false;
  props['REVIEW_STATE_R1'] = JSON.stringify({ status: 'DEAD', attemptCount: 3, timestamp: Date.now() - 3600000 });
});

// TEST 6: Progressive failures to DEAD
console.log(`\n==== RUNNING TEST: Progressive failures to DEAD ====`);
mock.setup({
  MULTI_LOCATION_CONFIG: JSON.stringify([{
    locationPath: "locations/123", businessName: "TestBiz", businessType: "Store", seoKeywords: ["test"], supportNumber: "123"
  }]),
  GEMINI_API_KEY: 'test-key',
  GEMINI_MODEL: 'gemini-1.5-flash'
});
global.SIMULATE_GEMINI_ERROR = 500; // Trigger failures
console.log('Run 1...');
checkNewReviews();
let props = mock.getProps();
// Clear cooldown so we can run again immediately
props['GEMINI_COOLDOWN_UNTIL'] = '';
// Override timestamp so it skips the 1-hour retry wait
let R5_UNREPLIED_ON_PAGE2State = JSON.parse(props['REVIEW_STATE_R5_UNREPLIED_ON_PAGE2']);
R5_UNREPLIED_ON_PAGE2State.timestamp = Date.now() - 4000000;
props['REVIEW_STATE_R5_UNREPLIED_ON_PAGE2'] = JSON.stringify(R5_UNREPLIED_ON_PAGE2State);

console.log('\nRun 2...');
checkNewReviews();
props = mock.getProps();
props['GEMINI_COOLDOWN_UNTIL'] = '';
R5_UNREPLIED_ON_PAGE2State = JSON.parse(props['REVIEW_STATE_R5_UNREPLIED_ON_PAGE2']);
R5_UNREPLIED_ON_PAGE2State.timestamp = Date.now() - 4000000;
props['REVIEW_STATE_R5_UNREPLIED_ON_PAGE2'] = JSON.stringify(R5_UNREPLIED_ON_PAGE2State);

console.log('\nRun 3...');
checkNewReviews();
props = mock.getProps();
props['GEMINI_COOLDOWN_UNTIL'] = '';
R5_UNREPLIED_ON_PAGE2State = JSON.parse(props['REVIEW_STATE_R5_UNREPLIED_ON_PAGE2']);
R5_UNREPLIED_ON_PAGE2State.timestamp = Date.now() - 4000000;
props['REVIEW_STATE_R5_UNREPLIED_ON_PAGE2'] = JSON.stringify(R5_UNREPLIED_ON_PAGE2State);

console.log('\nRun 4...');
checkNewReviews();

console.log('\n==== ALL TESTS COMPLETED ====');

// TEST 7: Pagination Multiple Pages
runTest('Pagination Multiple Pages', props => {
  global.SIMULATE_GEMINI_ERROR = false;
  global.SIMULATE_INFINITE_LOOP = false;
  props['GMB_REPLY_DRY_RUN'] = 'true';
});

// TEST 8: Infinite Loop Protection
runTest('Infinite Loop Protection', props => {
  global.SIMULATE_GEMINI_ERROR = false;
  global.SIMULATE_INFINITE_LOOP = true;
  props['GMB_REPLY_DRY_RUN'] = 'true';
});
