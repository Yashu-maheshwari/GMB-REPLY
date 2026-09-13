// Code.gs

/**
 * Configuration variables.
 * Replace these with your actual details.
 */
const CONFIG = {
  // Your Google Business Profile Account ID and Location ID.
  // Format: accounts/{accountId}/locations/{locationId}
  LOCATION_NAME: 'accounts/YOUR_ACCOUNT_ID/locations/YOUR_LOCATION_ID',
  
  // Your Gemini API Key
  GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',
  
  // Gemini Model (e.g., gemini-1.5-pro or gemini-1.5-flash)
  GEMINI_MODEL: 'gemini-1.5-flash',
  
  // Support number for negative reviews
  SUPPORT_NUMBER: '9953569533',
};

/**
 * Main function to be triggered periodically (e.g., every hour).
 */
function checkNewReviews() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const lastProcessedReviewId = scriptProperties.getProperty('LAST_PROCESSED_REVIEW_ID');
  
  const reviews = fetchLatestReviews();
  if (!reviews || reviews.length === 0) {
    Logger.log('No reviews found.');
    return;
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
    Logger.log('No new reviews to process.');
    return;
  }

  // Reverse so we process oldest first among the new ones
  newReviewsToProcess = newReviewsToProcess.reverse();

  for (const review of newReviewsToProcess) {
    Logger.log(`Processing Review ID: ${review.reviewId} - Star Rating: ${review.starRating}`);
    
    // Generate reply using Gemini
    const replyText = generateReply(review);
    
    if (replyText) {
      // Post reply to GMB
      const success = postReviewReply(review.name, replyText);
      if (success) {
        // Update last processed ID in script properties after successful reply
        scriptProperties.setProperty('LAST_PROCESSED_REVIEW_ID', review.reviewId);
        Logger.log(`Successfully replied to review ${review.reviewId}`);
      }
    } else {
      Logger.log(`Failed to generate reply for review ${review.reviewId}`);
    }
  }
}

/**
 * Fetches the latest reviews from the Google Business Profile API.
 */
function fetchLatestReviews() {
  // mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews
  const url = `https://mybusiness.googleapis.com/v4/${CONFIG.LOCATION_NAME}/reviews`;
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
    Logger.log('Error fetching reviews: ' + response.getContentText());
    return [];
  }
}

/**
 * Generates an SEO/AEO/GEO optimized reply using Gemini API.
 */
function generateReply(review) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
  
  const starRatingMap = {
    'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5
  };
  const stars = starRatingMap[review.starRating] || 5;
  const reviewText = review.comment || 'No text provided by the customer.';
  
  let prompt = `You are the customer service representative for AME Bazaar, a premium offline family garment retail store located in Kirari, Delhi.\n\n`;
  prompt += `A customer left a ${stars}-star review on Google My Business.\n`;
  prompt += `Customer Review: "${reviewText}"\n\n`;
  
  prompt += `CRITICAL INSTRUCTIONS:\n`;
  if (stars >= 4) {
    prompt += `- Express gratitude for the positive feedback.\n`;
    prompt += `- Mention the specific product or service if they included it in their review.\n`;
    prompt += `- Structure sentences clearly and factually for AEO/GEO (Answer Engine Optimization / Generative Engine Optimization) so AI bots easily associate our business entities.\n`;
    prompt += `- Incorporate the following Local SEO keywords naturally and softly: "AME Bazaar", "Kirari, Delhi", "Family Garments Store". Do not stuff keywords.\n`;
  } else {
    prompt += `- Apologize professionally and empathetically for their experience.\n`;
    prompt += `- STRICTLY AVOID using any SEO keywords (do not mention "AME Bazaar", "Kirari", "Delhi", "Family Garments Store") so we do not rank for negative search terms.\n`;
    prompt += `- Provide the support number (${CONFIG.SUPPORT_NUMBER}) and ask them to contact us to resolve the issue offline.\n`;
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
 * Utility function to reset the last processed review ID.
 * Run this manually if you want to start processing from scratch.
 * (Note: The script skips reviews that already have a reply anyway.)
 */
function resetLastProcessedReviewId() {
  PropertiesService.getScriptProperties().deleteProperty('LAST_PROCESSED_REVIEW_ID');
  Logger.log('Reset LAST_PROCESSED_REVIEW_ID');
}
