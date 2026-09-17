/**
 * GMB-REPLY - Google Apps Script
 * Automated Review Reply System with Gemini API
 * Safety features: Persistent State, Circuit Breaker, Rate Limiting, Dry Run
 */

// --- CONFIGURATION ---
const MAX_GEMINI_CALLS_PER_RUN = 3;
const COOLDOWN_DURATION_MS = 60 * 60 * 1000; // 1 hour
const STATE_QUEUED = 'QUEUED';
const STATE_GENERATING = 'GENERATING';
const STATE_REPLIED = 'REPLIED';
const STATE_FAILED = 'FAILED';
const STATE_RETRY_WAIT = 'RETRY_WAIT';
const STATE_DEAD = 'DEAD';

function getAccountId() {
  const url = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
  const token = ScriptApp.getOAuthToken();
  const options = { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() === 200) {
    const json = JSON.parse(response.getContentText());
    if (json.accounts && json.accounts.length > 0) return json.accounts[0].name; 
  }
  Logger.log('Could not fetch Account ID: ' + response.getContentText());
  return null;
}

function checkNewReviews() {
  Logger.log('--- checkNewReviews Execution Started ---');
  const scriptProperties = PropertiesService.getScriptProperties();
  const allProps = scriptProperties.getProperties(); // Efficient 1-read cache
  
  function getProp(key) { return allProps[key]; }
  function setProp(key, value) {
    const strVal = String(value);
    allProps[key] = strVal;
    scriptProperties.setProperty(key, strVal);
  }
  
  // Dry run check
  const isDryRun = getProp('GMB_REPLY_DRY_RUN') === 'true';
  if (isDryRun) Logger.log('DRY RUN MODE ENABLED - No real API calls to Gemini or GBP Reply will be made.');

  const configString = getProp('MULTI_LOCATION_CONFIG');
  if (!configString) return Logger.log('MULTI_LOCATION_CONFIG not found.');
  
  const locations = JSON.parse(configString);
  const geminiApiKey = getProp('GEMINI_API_KEY');
  if (!geminiApiKey && !isDryRun) return Logger.log('ERROR: GEMINI_API_KEY not found.');
  
  const geminiModel = getProp('GEMINI_MODEL') || 'gemini-1.5-flash-latest';
  
  // Circuit Breaker Check
  const cooldownStr = getProp('GEMINI_COOLDOWN_UNTIL');
  if (cooldownStr) {
    const cooldownUntil = parseInt(cooldownStr, 10);
    if (Date.now() < cooldownUntil) {
      Logger.log(`CIRCUIT BREAKER ACTIVE. Skipping Gemini calls until ${new Date(cooldownUntil).toISOString()}.`);
      return;
    } else {
      Logger.log('Cooldown expired. Resetting circuit breaker.');
      setProp('GEMINI_COOLDOWN_UNTIL', '');
    }
  }

  const accountId = getAccountId();
  if (!accountId) return Logger.log('Failed to retrieve Account ID. Aborting.');

  let geminiCallsMade = 0;
  let circuitBreakerActivated = false;

  for (const location of locations) {
    if (circuitBreakerActivated) break;
    Logger.log(`\nLocation: ${location.businessName}`);
    
    const reviews = fetchLatestReviews(accountId, location.locationPath);
    if (!reviews || reviews.length === 0) {
      Logger.log('No reviews found for this location.');
      continue;
    }

    // Process oldest unreplied reviews first
    const unrepliedReviews = reviews.filter(r => !r.reviewReply || !r.reviewReply.comment).reverse();
    if (unrepliedReviews.length === 0) {
      Logger.log('No unreplied reviews to process.');
      continue;
    }

    for (const review of unrepliedReviews) {
      if (circuitBreakerActivated) break;

      const stateKey = `REVIEW_STATE_${review.reviewId}`;
      const stateStr = getProp(stateKey);
      let reviewState = stateStr ? JSON.parse(stateStr) : { status: STATE_QUEUED, attemptCount: 0, timestamp: 0 };
      
      // Ensure attemptCount exists
      reviewState.attemptCount = reviewState.attemptCount || 0;
      
      // State Logic
      if (reviewState.status === STATE_REPLIED) {
        continue; // Already replied, safety net
      }
      if (reviewState.status === STATE_DEAD) {
        Logger.log(`Skipping review ${review.reviewId} - marked DEAD after max failed attempts.`);
        continue;
      }
      if (reviewState.status === STATE_GENERATING) {
        // It was interrupted previously. If it's been less than 1 hour, skip to prevent race conditions
        if (Date.now() - reviewState.timestamp < 3600000) {
          Logger.log(`Skipping review ${review.reviewId} - currently marked as GENERATING.`);
          continue;
        }
      }
      if (reviewState.status === STATE_FAILED || reviewState.status === STATE_RETRY_WAIT) {
        if (Date.now() - reviewState.timestamp < COOLDOWN_DURATION_MS) {
          Logger.log(`Skipping review ${review.reviewId} - waiting for cooldown to expire.`);
          continue;
        }
      }

      // Hard Limit Check
      if (geminiCallsMade >= MAX_GEMINI_CALLS_PER_RUN) {
        Logger.log(`MAX_GEMINI_CALLS_PER_RUN (${MAX_GEMINI_CALLS_PER_RUN}) reached. Saving remaining for next execution.`);
        return; // Exit safely
      }

      Logger.log(`Processing Review: ${review.reviewId} (Attempt ${reviewState.attemptCount + 1})`);
      
      // Persist state BEFORE calling Gemini
      reviewState.status = STATE_GENERATING;
      reviewState.timestamp = Date.now();
      setProp(stateKey, JSON.stringify(reviewState));

      if (isDryRun) {
        Logger.log(`[DRY RUN] Would call Gemini for review ${review.reviewId}`);
        reviewState.status = STATE_REPLIED;
        reviewState.timestamp = Date.now();
        setProp(stateKey, JSON.stringify(reviewState));
        geminiCallsMade++;
        continue;
      }

      // 1. Generate Reply
      const result = generateReply(review, location, geminiApiKey, geminiModel);
      geminiCallsMade++;
      
      reviewState.attemptCount += 1;
      const isMaxRetries = reviewState.attemptCount >= 3;

      if (result.error) {
        Logger.log(`Gemini API Error: ${result.status} - ${result.error}`);
        reviewState.status = isMaxRetries ? STATE_DEAD : STATE_FAILED;
        if (isMaxRetries) Logger.log(`Review ${review.reviewId} marked DEAD after 3 Gemini failures.`);
        reviewState.timestamp = Date.now();
        setProp(stateKey, JSON.stringify(reviewState));
        
        // Trigger Circuit Breaker on quota/auth/model errors
        if ([429, 403, 404, 500, 503].includes(result.status)) {
          Logger.log(`ACTIVATING CIRCUIT BREAKER due to HTTP ${result.status}`);
          setProp('GEMINI_COOLDOWN_UNTIL', (Date.now() + COOLDOWN_DURATION_MS).toString());
          circuitBreakerActivated = true;
          break; // Stop location loop
        }
      } else if (result.text) {
        // 2. Post Reply
        if (postReviewReply(review.name, result.text)) {
          reviewState.status = STATE_REPLIED;
          reviewState.timestamp = Date.now();
          setProp(stateKey, JSON.stringify(reviewState));
          Logger.log(`Successfully replied to review ${review.reviewId}`);
        } else {
          Logger.log(`Failed to post reply to GBP for review ${review.reviewId}`);
          reviewState.status = isMaxRetries ? STATE_DEAD : STATE_RETRY_WAIT;
          if (isMaxRetries) Logger.log(`Review ${review.reviewId} marked DEAD after 3 GBP post failures.`);
          reviewState.timestamp = Date.now();
          setProp(stateKey, JSON.stringify(reviewState));
        }
      } else {
        Logger.log(`Unknown Gemini failure for review ${review.reviewId}`);
        reviewState.status = isMaxRetries ? STATE_DEAD : STATE_FAILED;
        if (isMaxRetries) Logger.log(`Review ${review.reviewId} marked DEAD after 3 unknown failures.`);
        reviewState.timestamp = Date.now();
        setProp(stateKey, JSON.stringify(reviewState));
      }

      // Secondary protection delay
      if (!isDryRun) Utilities.sleep(4000);
    }
  }
  Logger.log('--- checkNewReviews Execution Finished ---');
}

function fetchLatestReviews(accountId, locationPath) {
  const locId = locationPath.split('/').pop();
  const url = `https://mybusiness.googleapis.com/v4/${accountId}/locations/${locId}/reviews`;
  const options = { method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  const response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() === 200) return JSON.parse(response.getContentText()).reviews || [];
  Logger.log(`Error fetching reviews: ` + response.getContentText());
  return [];
}

function generateReply(review, location, apiKey, model) {
  // Validate and format model string securely
  let formattedModel = (model || 'gemini-1.5-flash-latest').trim();
  if (formattedModel === '' || !/^[a-zA-Z0-9.\-]+$/.test(formattedModel.replace('models/', ''))) {
    return { error: 'Invalid model format in properties', status: 400 };
  }
  if (!formattedModel.startsWith('models/')) {
    formattedModel = 'models/' + formattedModel;
  }
  
  const url = `https://generativelanguage.googleapis.com/v1beta/${formattedModel}:generateContent?key=${apiKey}`;
  const starMap = { 'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5 };
  const stars = starMap[review.starRating] || 5;
  const reviewText = review.comment || 'No text provided.';
  const keywords = Array.isArray(location.seoKeywords) ? location.seoKeywords.join(', ') : location.seoKeywords;
  
  let prompt = `You are customer support for ${location.businessName}, a ${location.businessType}.\nReview: ${stars} Stars. "${reviewText}"\n`;
  if (stars >= 4) {
    prompt += `Task: Thank them. Naturally include keywords: "${location.businessName}", ${keywords}. Optimize for local SEO/AEO. Keep it professional.`;
  } else {
    prompt += `Task: Apologize. DO NOT use SEO keywords. Ask them to call ${location.supportNumber} to resolve it.`;
  }
  prompt += `\nReply in casual Hinglish. No markdown. Just the exact text to post.`;

  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code === 200) {
      const json = JSON.parse(response.getContentText());
      if (json.candidates && json.candidates.length > 0) {
        return { text: json.candidates[0].content.parts[0].text.trim(), status: 200 };
      }
      return { error: 'No candidates in response', status: 500 };
    }
    return { error: response.getContentText(), status: code };
  } catch (e) { 
    return { error: e.toString(), status: 500 };
  }
}

function postReviewReply(reviewName, replyText) {
  const url = `https://mybusiness.googleapis.com/v4/${reviewName}/reply`;
  const options = { method: 'put', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, contentType: 'application/json', payload: JSON.stringify({ comment: replyText }), muteHttpExceptions: true };
  return UrlFetchApp.fetch(url, options).getResponseCode() === 200;
}

function setupEnvironmentProperties() {
  const config = [
    { "locationPath": "locations/16134813121256220692", "businessName": "AME Bazaar", "businessType": "Retail Garment Store", "seoKeywords": ["AME Bazaar", "Family Garments Store in Kirari", "best quality affordable clothes"], "supportNumber": "9953569533" },
    { "locationPath": "locations/1571247269233718336", "businessName": "Maheshwari Counsel | Advocates & Legal Consultants", "businessType": "Law Firm", "seoKeywords": ["Maheshwari Counsel", "Advocates in Delhi", "Legal Consultants", "civil and criminal lawyer"], "supportNumber": "YOUR_LAW_PRACTICE_NUMBER" },
    { "locationPath": "locations/12195894669850420443", "businessName": "Advaith Educational Centre", "businessType": "Educational Coaching Institute", "seoKeywords": ["Advaith Educational Centre", "best coaching institute in Kirari", "tuition classes Delhi", "top educational center"], "supportNumber": "YOUR_ADVAITH_NUMBER" },
    { "locationPath": "locations/4069269303360601513", "businessName": "SIS", "businessType": "School / Educational Institution", "seoKeywords": ["SIS School", "best school in Kirari", "quality education Delhi", "top school admission"], "supportNumber": "YOUR_SCHOOL_NUMBER" }
  ];
  PropertiesService.getScriptProperties().setProperty('MULTI_LOCATION_CONFIG', JSON.stringify(config));
  Logger.log('Config injected.');
}
