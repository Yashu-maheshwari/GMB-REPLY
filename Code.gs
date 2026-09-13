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
  const scriptProperties = PropertiesService.getScriptProperties();
  const configString = scriptProperties.getProperty('MULTI_LOCATION_CONFIG');
  if (!configString) return Logger.log('MULTI_LOCATION_CONFIG not found.');
  
  const locations = JSON.parse(configString);
  const geminiApiKey = scriptProperties.getProperty('GEMINI_API_KEY');
  if (!geminiApiKey) return Logger.log('ERROR: GEMINI_API_KEY not found.');
  const geminiModel = scriptProperties.getProperty('GEMINI_MODEL') || 'gemini-1.5-flash';

  const accountId = getAccountId();
  if (!accountId) return Logger.log('Failed to retrieve Account ID. Aborting.');

  for (const location of locations) {
    Logger.log(`\n--- Processing Location: ${location.businessName} ---`);
    const propKey = `LAST_PROCESSED_REVIEW_ID_${location.locationPath}`;
    const lastProcessedReviewId = scriptProperties.getProperty(propKey);
    
    const reviews = fetchLatestReviews(accountId, location.locationPath);
    if (!reviews || reviews.length === 0) {
      Logger.log('No reviews found for this location.');
      continue;
    }

    let newReviewsToProcess = [];
    for (let i = 0; i < reviews.length; i++) {
      if (reviews[i].reviewId === lastProcessedReviewId) break;
      if (!reviews[i].reviewReply || !reviews[i].reviewReply.comment) newReviewsToProcess.push(reviews[i]);
    }

    if (newReviewsToProcess.length === 0) {
      Logger.log('No new reviews to process.');
      continue;
    }

    newReviewsToProcess.reverse();
    for (const review of newReviewsToProcess) {
      const replyText = generateReply(review, location, geminiApiKey, geminiModel);
      if (replyText) {
        if (postReviewReply(review.name, replyText)) {
          scriptProperties.setProperty(propKey, review.reviewId);
          Logger.log(`Successfully replied to review ${review.reviewId}`);
        }
      }
    }
  }
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
    const json = JSON.parse(response.getContentText());
    if (response.getResponseCode() === 200 && json.candidates) return json.candidates[0].content.parts[0].text.trim();
  } catch (e) { Logger.log('Error: ' + e.toString()); }
  return null;
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
