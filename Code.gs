// Code.gs

/**
 * Fallback Mock Configuration for Multiple Locations.
 * 
 * If 'MULTI_LOCATION_CONFIG' is not found in Script Properties, 
 * this mock array will be used and saved to Script Properties for you to edit.
 */
const DEFAULT_MULTI_LOCATION_CONFIG = [
  {
    "locationPath": "accounts/YOUR_ACCOUNT_ID/locations/YOUR_LOCATION_ID_1",
    "businessName": "AME Bazaar",
    "businessType": "premium offline family garment retail store",
    "seoKeywords": ["AME Bazaar", "Kirari, Delhi", "Family Garments Store", "Men's wear", "Women's wear", "Kids wear"],
    "supportNumber": "9953569533"
  },
  {
    "locationPath": "accounts/YOUR_ACCOUNT_ID/locations/YOUR_LOCATION_ID_2",
    "businessName": "AME Bazaar Branch 2",
    "businessType": "premium clothing store",
    "seoKeywords": ["AME Bazaar Branch 2", "Rohini, Delhi", "Fashion Retailer"],
    "supportNumber": "9811000000"
  }
];

/**
 * Main function to be triggered periodically (e.g., every hour).
 */
function checkNewReviews() {
  const scriptProperties = PropertiesService.getScriptProperties();
  
  // 1. Get or initialize the MULTI_LOCATION_CONFIG
  let configString = scriptProperties.getProperty('MULTI_LOCATION_CONFIG');
  if (!configString) {
    Logger.log('MULTI_LOCATION_CONFIG not found in Script Properties. Initializing with default mock data.');
    configString = JSON.stringify(DEFAULT_MULTI_LOCATION_CONFIG);
    scriptProperties.setProperty('MULTI_LOCATION_CONFIG', configString);
  }
  
  const locations = JSON.parse(configString);
  
  // 2. Get Gemini API Key
  const geminiApiKey = scriptProperties.getProperty('GEMINI_API_KEY');
  if (!geminiApiKey) {
    Logger.log('ERROR: GEMINI_API_KEY not found in Script Properties. Please add it.');
    return;
  }
  
  const geminiModel = scriptProperties.getProperty('GEMINI_MODEL') || 'gemini-1.5-flash';

  // 3. Loop through all locations
  for (const location of locations) {
    Logger.log(`\n--- Processing Location: ${location.businessName} (${location.locationPath}) ---`);
    
    const propKey = `LAST_PROCESSED_REVIEW_ID_${location.locationPath}`;
    const lastProcessedReviewId = scriptProperties.getProperty(propKey);
    
    const reviews = fetchLatestReviews(location.locationPath);
    if (!reviews || reviews.length === 0) {
      Logger.log('No reviews found for this location.');
      continue;
    }

    // Find new reviews by comparing against the last processed review ID
    let newReviewsToProcess = [];
    
    for (let i = 0; i < reviews.length; i++) {
      const review = reviews[i];
      if (review.reviewId === lastProcessedReviewId) {
        break; // Found the last processed, so everything before this in our array is new
      }
      // Only process if it doesn't already have a reply
      if (!review.reviewReply || !review.reviewReply.comment) {
          newReviewsToProcess.push(review);
      }
    }

    if (newReviewsToProcess.length === 0) {
      Logger.log('No new reviews to process for this location.');
      continue;
    }

    // Reverse so we process oldest first among the new ones
    newReviewsToProcess = newReviewsToProcess.reverse();

    for (const review of newReviewsToProcess) {
      Logger.log(`Processing Review ID: ${review.reviewId} - Star Rating: ${review.starRating}`);
      
      // Generate reply using Gemini
      const replyText = generateReply(review, location, geminiApiKey, geminiModel);
      
      if (replyText) {
        // Post reply to GMB
        const success = postReviewReply(review.name, replyText);
        if (success) {
          // Update last processed ID in script properties after successful reply
          scriptProperties.setProperty(propKey, review.reviewId);
          Logger.log(`Successfully replied to review ${review.reviewId}`);
        }
      } else {
        Logger.log(`Failed to generate reply for review ${review.reviewId}`);
      }
    }
  }
}

/**
 * Fetches the latest reviews from the Google Business Profile API for a specific location.
 */
function fetchLatestReviews(locationPath) {
  const url = `https://mybusiness.googleapis.com/v4/${locationPath}/reviews`;
  const token = ScriptApp.getOAuthToken();
  
  const options = {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token
    },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  
  if (response.getResponseCode() === 200) {
    return json.reviews || [];
  } else {
    Logger.log(`Error fetching reviews for ${locationPath}: ` + response.getContentText());
    return [];
  }
}

/**
 * Generates an SEO/AEO/GEO optimized reply using Gemini API tailored to the specific location.
 */
function generateReply(review, location, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const starRatingMap = {
    'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5
  };
  const stars = starRatingMap[review.starRating] || 5;
  const reviewText = review.comment || 'No text provided by the customer.';
  
  // Parse keywords into a string
  const keywordsString = Array.isArray(location.seoKeywords) 
    ? location.seoKeywords.join(', ') 
    : location.seoKeywords;
  
  let prompt = `You are the customer service representative for ${location.businessName}, a ${location.businessType}.\n\n`;
  prompt += `A customer left a ${stars}-star review on Google My Business.\n`;
  prompt += `Customer Review: "${reviewText}"\n\n`;
  
  prompt += `CRITICAL INSTRUCTIONS:\n`;
  if (stars >= 4) {
    prompt += `- Express gratitude for the positive feedback.\n`;
    prompt += `- Mention the specific product or service if they included it in their review.\n`;
    prompt += `- Structure sentences clearly and factually for AEO/GEO (Answer Engine Optimization / Generative Engine Optimization) so AI bots easily associate our business entities.\n`;
    prompt += `- Incorporate the following Local SEO keywords naturally and softly: "${location.businessName}", ${keywordsString}. Do not stuff keywords.\n`;
  } else {
    prompt += `- Apologize professionally and empathetically for their experience.\n`;
    prompt += `- STRICTLY AVOID using any SEO keywords (do not mention the business name "${location.businessName}" or any of these keywords: ${keywordsString}) so we do not rank for negative search terms.\n`;
    prompt += `- Provide the support number (${location.supportNumber}) and ask them to contact us to resolve the issue offline.\n`;
  }
  
  prompt += `- Keep the reply concise and professional.\n`;
  prompt += `\nWrite only the reply text, without any quotes, markdown formatting, or preamble.`;

  const payload = {
    contents: [{
      parts: [{
        text: prompt
      }]
    }]
  };
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    if (response.getResponseCode() === 200 && json.candidates && json.candidates.length > 0) {
      return json.candidates[0].content.parts[0].text.trim();
    } else {
      Logger.log('Error generating reply from Gemini: ' + response.getContentText());
      return null;
    }
  } catch (e) {
    Logger.log('Exception calling Gemini API: ' + e.toString());
    return null;
  }
}

/**
 * Posts the generated reply to the specified review via GMB API.
 */
function postReviewReply(reviewName, replyText) {
  // reviewName format: accounts/{accountId}/locations/{locationId}/reviews/{reviewId}
  const url = `https://mybusiness.googleapis.com/v4/${reviewName}/reply`;
  const token = ScriptApp.getOAuthToken();
  
  const payload = {
    comment: replyText
  };
  
  const options = {
    method: 'put',
    headers: {
      Authorization: 'Bearer ' + token
    },
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  
  if (response.getResponseCode() === 200) {
    return true;
  } else {
    Logger.log(`Error posting reply to ${reviewName}: ` + response.getContentText());
    return false;
  }
}

/**
 * Utility function to reset the last processed review IDs for all locations in config.
 * Run this manually if you want to start processing from scratch.
 */
function resetAllLastProcessedReviewIds() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const configString = scriptProperties.getProperty('MULTI_LOCATION_CONFIG');
  
  if (configString) {
    const locations = JSON.parse(configString);
    locations.forEach(location => {
      const propKey = `LAST_PROCESSED_REVIEW_ID_${location.locationPath}`;
      scriptProperties.deleteProperty(propKey);
      Logger.log(`Reset ${propKey}`);
    });
  } else {
    Logger.log('MULTI_LOCATION_CONFIG not found. Cannot reset review IDs.');
  }
}

/**
 * One-time execution function to automatically inject the correct configuration
 * into PropertiesService for multi-location AI generation.
 */
function setupEnvironmentProperties() {
  const config = [
    {
      "locationPath": "accounts/YOUR_ACCOUNT_ID/locations/AME_BAZAAR_ID",
      "businessName": "AME Bazaar",
      "businessType": "Retail Garment Store",
      "seoKeywords": ["AME Bazaar", "Family Garments Store in Kirari", "best quality affordable clothes"],
      "supportNumber": "9953569533"
    },
    {
      "locationPath": "accounts/YOUR_ACCOUNT_ID/locations/LAW_FIRM_ID",
      "businessName": "Maheshwari Counsel | Advocates & Legal Consultants",
      "businessType": "Law Firm",
      "seoKeywords": ["Maheshwari Counsel", "Advocates in Delhi", "Legal Consultants", "civil and criminal lawyer"],
      "supportNumber": "YOUR_LAW_PRACTICE_NUMBER"
    },
    {
      "locationPath": "accounts/YOUR_ACCOUNT_ID/locations/ADVAITH_ID",
      "businessName": "Advaith Educational Centre",
      "businessType": "Educational Coaching Institute",
      "seoKeywords": ["Advaith Educational Centre", "best coaching institute in Kirari", "tuition classes Delhi", "top educational center"],
      "supportNumber": "YOUR_ADVAITH_NUMBER"
    },
    {
      "locationPath": "accounts/YOUR_ACCOUNT_ID/locations/SIS_SCHOOL_ID",
      "businessName": "SIS",
      "businessType": "School / Educational Institution",
      "seoKeywords": ["SIS School", "best school in Kirari", "quality education Delhi", "top school admission"],
      "supportNumber": "YOUR_SCHOOL_NUMBER"
    }
  ];
  
  PropertiesService.getScriptProperties().setProperty('MULTI_LOCATION_CONFIG', JSON.stringify(config));
  Logger.log('Environment configuration successfully injected into PropertiesService!');
}
