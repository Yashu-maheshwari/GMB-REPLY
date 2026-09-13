# GMB Review Auto-Reply System

A standalone, fully automated Google My Business (GMB) / Google Business Profile (GBP) Review Auto-Reply system built entirely in Google Apps Script (GAS). This system uses the Gemini API to generate intelligent, SEO/AEO/GEO-optimized responses to customer reviews based on their star ratings.

## Features
- **No External Webhooks:** Runs completely inside Google Apps Script using Time-Driven Triggers.
- **AI-Powered Replies:** Uses Gemini API for contextual reply generation.
- **Smart Logic (SEO/AEO/GEO):**
  - **4 or 5 Stars:** Incorporates local SEO keywords ("AME Bazaar", "Kirari, Delhi", "Family Garments Store") softly, expresses gratitude, and structurally optimizes for AI search bots (AEO/GEO).
  - **1, 2, or 3 Stars:** Issues a professional apology, strictly avoids local SEO keywords to prevent ranking for negative terms, and provides a direct support phone number to resolve issues offline.
- **State Management:** Uses GAS Script Properties to remember the last processed review and avoid duplicate processing.

## Setup Instructions

### 1. Set Up Google Cloud Console Project
To use the Google Business Profile API, you need a Google Cloud Project with the API enabled.
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Navigate to **APIs & Services > Library**.
4. Search for **Google My Business API** and enable it.
5. Search for **My Business Account Management API** and enable it.
6. Configure the **OAuth consent screen** (set to Internal or External depending on your workspace) and add the scope `https://www.googleapis.com/auth/business.manage`.

### 2. Create the Google Apps Script Project
1. Go to [Google Apps Script](https://script.google.com/).
2. Create a **New Project**.
3. Copy the contents of `Code.gs` into the main script file.
4. Go to **Project Settings** (gear icon) and check the box for **"Show 'appsscript.json' manifest file in editor"**.
5. Replace the contents of `appsscript.json` with the provided `appsscript.json` from this repository.

### 3. Link the Cloud Project to Apps Script
1. In the Apps Script editor, go to **Project Settings**.
2. Under **Google Cloud Platform (GCP) Project**, click **Change project**.
3. Enter the **Project Number** of the Google Cloud Project you created in Step 1 (found on the GCP dashboard) and click **Set project**.

### 4. Configure Script Variables
In `Code.gs`, update the `CONFIG` object with your specific details:
- `LOCATION_NAME`: Your Google Business Profile account and location ID (e.g., `accounts/123456789/locations/987654321`).
- `GEMINI_API_KEY`: Your Google AI Studio (Gemini) API key.
- `SUPPORT_NUMBER`: Your business support number (default is set to `9953569533`).

### 5. Run Initialization & Authorization
1. In the Apps Script editor, select the `checkNewReviews` function from the top dropdown and click **Run**.
2. Google will prompt you to authorize the script. Accept the permissions. 
3. *Note: The first run might not reply if it's processing historical reviews, or it will log the latest review. You can manually run `resetLastProcessedReviewId` to reset the tracking state.*

### 6. Set Up the Time-Driven Trigger
To make the script run automatically:
1. In the Apps Script editor, click the **Triggers** icon (clock icon) on the left sidebar.
2. Click **Add Trigger** (bottom right).
3. Set the following configuration:
   - **Choose which function to run:** `checkNewReviews`
   - **Choose which deployment should run:** `Head`
   - **Select event source:** `Time-driven`
   - **Select type of time based trigger:** `Hour timer` (or your preferred frequency)
   - **Select hour interval:** `Every hour`
4. Click **Save**.

The system is now fully automated and will periodically check for new reviews and post optimized AI replies!
