// GENERATED 2026-10-11 from the strings that were hard-coded in wactoWebhookController.js and
// paymentProof.js. These are the DEFAULTS; the admin "Bot Messages & Media" page stores
// overrides in app_flow_messages (bot_<key>_en / bot_<key>_ta) and app_flow_images (bot_img_<key>).
// {var} placeholders are filled by the backend at send time (see `vars`).

export const BOT_GROUPS = [
  {
    "id": "registration",
    "name": "Registration",
    "note": "Backend replies during the 6-step registration (the step lists themselves are WACTO flow nodes)"
  },
  {
    "id": "menu",
    "name": "Service menu",
    "note": "Follow-ups after a menu tap (WACTO sends the menu and its intro image first)"
  },
  {
    "id": "support",
    "name": "Support",
    "note": "2-step ticket: query → name"
  },
  {
    "id": "purchase",
    "name": "Purchase plan",
    "note": "Plan number → booth count → how to pay; and the 'pay' keyword"
  },
  {
    "id": "social",
    "name": "Social media request",
    "note": "Service → name & party → message → target area"
  },
  {
    "id": "payment",
    "name": "Payment & proof",
    "note": "QR caption and every screenshot-verification message"
  },
  {
    "id": "features",
    "name": "WhatsApp features (behind switches)",
    "note": "Pay Now / Pay Later, STOP and the website-login reply — each sent only while its switch on the WhatsApp Features page is on for that number (2026-10-16)"
  }
];

export const BOT_TEXTS = {
  "reg_booth_ask": {
    "group": "registration",
    "name": "Ask for booth numbers",
    "when": "After the assembly is chosen (step 6)",
    "vars": [
      "assembly"
    ],
    "en": "Which booth numbers do you manage in *{assembly}* assembly?\n\n📌 *Required format:* Numbers only, separated by commas\n\n✅ Correct: `1, 5, 9` or `12, 15, 20`\n❌ Wrong: `Booth 1`, `1-5`, `1 to 5`\n\nReply with your booth numbers now.",
    "ta": "🗳️ *{assembly}* சட்டமன்றத் தொகுதியில் உங்களுடைய பூத் எண்களை உள்ளிடவும்.\n\n📌 *பூத் எண்களை கமா (,) மூலம் பிரித்து அனுப்பவும்.*\n\n✅ சரியான முறை: `1, 5, 9` அல்லது `12, 15, 20`\n❌ தவறான முறை: `Booth 1`, `1-5` போன்ற குழப்பமான வடிவங்கள்."
  },
  "reg_booth_invalid": {
    "group": "registration",
    "name": "Booth numbers — wrong format",
    "when": "Reply to booth numbers that are not numbers",
    "vars": [
      "assembly"
    ],
    "en": "❌ Invalid format. Please reply with numbers only, separated by commas.\n\n✅ Example: `1, 5, 9`\n❌ Not valid: `Booth 1`, `1-5`, `1 to 5`\n\nWhich booth numbers do you manage in *{assembly}* assembly?",
    "ta": "❌ தவறான வடிவம்!\n\nதயவுசெய்து பூத் எண்களை மட்டும் கமா (,) மூலம் பிரித்து மீண்டும் உள்ளிடவும்.\n\n✅ சரியான எடுத்துக்காட்டு: `1, 5, 9`\n❌ தவறான எடுத்துக்காட்டு: `Booth 1`, `1-5`, `1 to 5`\n\n👇 *{assembly}* தொகுதிக்கான பூத் எண்களை மீண்டும் உள்ளிடவும்."
  },
  "reg_step_locked": {
    "group": "registration",
    "name": "Old tap / skipped step",
    "when": "A button from an earlier step is tapped",
    "vars": [
      "step"
    ],
    "en": "⚠️ You can't go back or skip steps.\n\n👉 Please continue with: *{step}*\n\nTo start again from the beginning, send *Hi*.",
    "ta": "⚠️ முந்தைய படிகளுக்குத் திரும்பவோ, படிகளைத் தவிர்க்கவோ முடியாது.\n\n👉 தொடர வேண்டிய படி: *{step}*\n\nமுதலிலிருந்து மீண்டும் தொடங்க *Hi* என அனுப்பவும்."
  },
  "reg_next_step": {
    "group": "registration",
    "name": "Pointer to the next step",
    "when": "First correct answer after a warning",
    "vars": [
      "step"
    ],
    "en": "✅ Got it.\n\n👉 Next: *{step}*. Use the list above.\n\nIf you don't see it, send *Hi* to start again.",
    "ta": "✅ சேமிக்கப்பட்டது.\n\n👉 அடுத்த படி: *{step}*. மேலே உள்ள பட்டியலைப் பயன்படுத்தவும்.\n\nஅது தெரியவில்லை என்றால், மீண்டும் தொடங்க *Hi* என அனுப்பவும்."
  },
  "reg_already_registered": {
    "group": "registration",
    "name": "Already registered",
    "when": "A registered number taps a registration step",
    "vars": [],
    "en": "✅ You're already registered with EDMS.\n\nTo see your login, select *My Credentials* from the menu.",
    "ta": "✅ தாங்கள் ஏற்கனவே EDMS கணக்கில் பதிவு செய்துள்ளீர்கள்.\n\nஉங்கள் கணக்கு விவரங்களைப் பார்க்க, மெனுவில் *எனது கணக்கு விவரங்கள்* என்பதைத் தேர்ந்தெடுக்கவும்."
  },
  "reg_complete": {
    "group": "registration",
    "name": "Registration complete",
    "when": "Sent with the 'registration complete' image; the QR message follows",
    "image": "registration_complete",
    "vars": [
      "mobile",
      "name",
      "passcode"
    ],
    "en": "✅ *Registration Complete!*\n\n🎉 Welcome to EDMS, *{name}*!\n\n🔑 *Username:* `{mobile}`\n🔒 *Passcode:* `{passcode}`\n\n📱 Login at: https://tnedms.com/login\n\n_Save these credentials. Do not share them._",
    "ta": "🎉 *பதிவு வெற்றிகரமாக முடிந்தது!*\n\nEDMS-க்கு நல்வரவு, *{name}*! 🙏\n\n🔑 *பயனர்பெயர்:* `{mobile}`\n🔒 *கடவுச்சொல்:* `{passcode}`\n\n📲 உள்நுழைய: https://tnedms.com/login\n\n⚠️ உங்கள் கணக்கு விவரங்களை யாருடனும் பகிர வேண்டாம்."
  },
  "reg_welcome_back": {
    "group": "registration",
    "name": "Welcome back (Register tapped again)",
    "when": "A registered number taps Register",
    "image": "credentials",
    "vars": [
      "mobile",
      "name",
      "passcode"
    ],
    "en": "👋 *Welcome back, {name}!*\n\nYou're already registered with EDMS.\n\n🔑 *Username:* `{mobile}`\n🔒 *Passcode:* `{passcode}`\n\n📲 Login at: https://tnedms.com/login\n\n_Need help? Select *Support* from the menu._",
    "ta": "👋 *மீண்டும் தங்களை வரவேற்கிறோம், {name}!*\n\nதாங்கள் ஏற்கனவே EDMS கணக்கில் பதிவு செய்துள்ளீர்கள்.\n\n🔑 *பயனர்பெயர்:* `{mobile}`\n🔒 *கடவுச்சொல்:* `{passcode}`\n\n📲 உள்நுழைய: https://tnedms.com/login\n\n_உதவி தேவையா? Menu-வில் *உதவி மையம்* என்பதைத் தேர்ந்தெடுக்கவும்._"
  },
  "reg_failed": {
    "group": "registration",
    "name": "Registration failed",
    "when": "Database error while saving",
    "vars": [],
    "en": "Sorry, registration failed. Please try again or visit https://tnedms.com/register",
    "ta": "மன்னிக்கவும், பதிவு தோல்வியடைந்தது. மீண்டும் முயற்சிக்கவும்: https://tnedms.com/register"
  },
  "menu_credentials": {
    "group": "menu",
    "name": "My Credentials",
    "when": "Menu → My Credentials (registered)",
    "image": "credentials",
    "vars": [
      "mobile",
      "passcode"
    ],
    "en": "🔑 Your EDMS Access Pass to Victory\n\nHere are your secure credentials to monitor and manage your local body campaign data:\n\n📱 Username: {mobile}\n🔒 Passcode: {passcode}\n\n📲 Login Link: https://tnedms.com/login\n\n💡 Winning Tip: Assign mobile logins to your ward and booth committee members to track ground voters live!\n\n⚠️ Keep your credentials confidential to protect your campaign intelligence.",
    "ta": "🔑 உங்கள் EDMS உள்நுழைவு விவரங்கள் (Login Credentials)\n\nஉள்ளாட்சித் தேர்தல் களத்தில் உங்கள் பூத் தரவுகளைப் பார்வையிடவும் நிர்வகிக்கவும் உங்கள் கடவுச்சொல் இதோ:\n\n📱 பயனர்பெயர் (Username): {mobile}\n🔒 கடவுச்சொல் (Passcode): {passcode}\n\n📲 உடனடி உள்நுழைவு லிங்க்: https://tnedms.com/login\n\n💡 வெற்றிக்கு ஒரு குறிப்பு: உங்கள் பூத் ஏஜெண்டுகளுக்கு தனித்தனி மொபைல் லாகின் கொடுத்து களப் பணியை இன்றே வேகப்படுத்துங்கள்!\n\n⚠️ உங்கள் கடவுச்சொல் மற்றும் வாக்காளர் தரவுகளை பாதுகாப்பாக வைத்துக்கொள்ளவும்."
  },
  "menu_no_account": {
    "group": "menu",
    "name": "My Credentials — no account",
    "when": "Menu → My Credentials (not registered)",
    "vars": [
      "mobile"
    ],
    "en": "⚠️ No account found for *{mobile}*.\n\nTo register, type *Register* or select *Register* from the menu.",
    "ta": "⚠️ *{mobile}* என்ற மொபைல் எண்ணிற்கு EDMS கணக்கு கண்டறியப்படவில்லை.\n\nபுதிதாகப் பதிவு செய்ய மெனுவில் *பதிவு செய்ய* என்பதைத் தேர்ந்தெடுக்கவும்."
  },
  "menu_support_intro": {
    "group": "menu",
    "name": "Support — ask for the query",
    "when": "Menu → Support, after WACTO's image",
    "vars": [],
    "en": "👇 Type your query directly below; our technical team responds within 2 hours!",
    "ta": "👇 உங்கள் சந்தேகத்தை கீழே தட்டச்சு செய்து அனுப்பலாம்; எங்கள் குழு 2 மணி நேரத்தில் பதிலளிக்கும்!"
  },
  "menu_purchase_plans": {
    "group": "menu",
    "name": "Purchase Plan — plan list",
    "when": "Menu → Purchase Plan, after WACTO's image",
    "vars": [],
    "en": "1️⃣ 1 Booth Plan — ₹2,000 (Ward-Level Direct Strategy)\n2️⃣ Up to 5 Booths Plan — ₹5,000 (Key Zone Domination)\n3️⃣ Up to 10 Booths Plan — ₹10,000 (Panchayat Union / Town Panchayat)\n4️⃣ Up to 25 Booths Plan — ₹25,000 (Full Municipality Control)\n5️⃣ Up to 100 Booths Plan — ₹50,000 (Corporation / Assembly Constituency Scale)\n\n(+ 18% GST)\n\n⚡ Instant Activation: Ground access is enabled within 30 minutes of payment.\n🔒 100% Secure, Trusted & Candidate-Confidential.\n\n👇 Reply with your choice (1, 2, 3, 4, or 5) to claim your plan:",
    "ta": "1️⃣ 1 பூத் திட்டம் — ₹2,000 (வார்டு நிலை நேரடி வியூகம்)\n2️⃣ 5 பூத் திட்டம் வரை — ₹5,000 (முக்கிய பகுதிகள் ஆதிக்கம்)\n3️⃣ 10 பூத் திட்டம் வரை — ₹10,000 (ஊராட்சி ஒன்றியம் / பேரூராட்சி)\n4️⃣ 25 பூத் திட்டம் வரை — ₹25,000 (நகராட்சி முழுமையான ஆதிக்கம்)\n5️⃣ 100 பூத் திட்டம் வரை — ₹50,000 (மாநகராட்சி / சட்டமன்றத் தொகுதி அளவு)\n\n(+ 18% GST)\n\n⚡ உடனடி செயல்படுத்தல்: கட்டணம் செலுத்திய 30 நிமிடங்களில் உங்கள் கணக்கு பயன்பாட்டிற்குத் தயார்!\n🔒 100% நம்பகமான & பாதுகாப்பான மென்பொருள்.\n\n👇 நீங்கள் வாங்க விரும்பும் திட்டத்தின் எண்ணை (1 முதல் 5 வரை) பதிலளிக்கவும்:"
  },
  "menu_social_intro": {
    "group": "menu",
    "name": "Social Media — service list",
    "when": "Menu → Social Media, after WACTO's image",
    "vars": [],
    "en": "1️⃣ WhatsApp Broadcast: Send flyers, manifesto points, and video appeals directly to voters' personal chats.\n2️⃣ Audio Voice SMS: Deliver your personal campaign appeal in your own voice straight as an automated phone call.\n3️⃣ Bulk SMS Broadcast: Urgent updates, booth details, and symbol reminders delivered directly to voter phones.\n\n🎯 Precision Ward & Booth Geo-Targeting — Zero Wasted Budget!\n\n👇 Reply with 1, 2, or 3 to select your outreach service:",
    "ta": "1️⃣ WhatsApp Broadcast: உங்கள் வேட்பாளர் படம், வாக்குறுதிகள் அடங்கிய துண்டுப் பிரசுரங்களை வாக்காளர்களின் வாட்ஸ்அப்பிற்கு நேரடியாக அனுப்புதல்.\n2️⃣ Audio / Voice SMS: உங்கள் சொந்தக் குரலில் வேட்பாளர் வாக்கு சேகரிக்கும் அழைப்பு வாக்காளர்களின் தொலைபேசிக்கு செல்லும்.\n3️⃣ Bulk SMS Broadcast: தேர்தல் சின்னம் மற்றும் முக்கிய அறிவிப்புகள் அடங்கிய உடனடி குறுஞ்செய்தி.\n\n🎯 இலக்கு வார்டு / பூத் மக்களுக்கு மட்டுமே செல்லும் — வீண் செலவு இல்லை!\n\n👇 நீங்கள் பயன்படுத்த விரும்பும் சேவையைத் தேர்வு செய்ய 1, 2 அல்லது 3 என்று பதிலளிக்கவும்:"
  },
  "support_ask_name": {
    "group": "support",
    "name": "Ask for the name",
    "when": "After the query is typed",
    "vars": [],
    "en": "📝 Got it. What is your name? _(type \"skip\" to skip)_",
    "ta": "📝 புரிந்தது. உங்கள் பெயரை உள்ளிடவும். (தவிர்க்க \"skip\" என்று டைப் செய்யவும்)"
  },
  "support_done": {
    "group": "support",
    "name": "Ticket received",
    "when": "After the name (or 'skip')",
    "vars": [],
    "en": "✅ *Support Request Received!*\n\nOur team will respond within *2 hours*.\n\nFor urgent help:\n📞 *+91 79047 59268*\n⏰ 8am – 10pm daily\n\nThank you! 🙏",
    "ta": "✅ *உங்கள் உதவி கோரிக்கை வெற்றிகரமாகப் பெறப்பட்டது!*\n\nஎங்கள் ஆதரவுக் குழு 2 மணி நேரத்திற்குள் உங்களைத் தொடர்புகொள்ளும்.\n\n🚨 அவசர உதவி:\n📞 *+91 79047 59268*\n⏰ தினமும் காலை 8:00 முதல் இரவு 10:00 மணி வரை\n\nநன்றி! 🙏"
  },
  "purchase_invalid": {
    "group": "purchase",
    "name": "Plan — wrong reply",
    "when": "Reply is not 1–5",
    "vars": [],
    "en": "Please reply with *1*, *2*, *3*, *4* or *5* to select a plan.\n\n1️⃣ 1 Booth — ₹2,000\n2️⃣ Up to 5 Booths — ₹5,000\n3️⃣ Up to 10 Booths — ₹10,000\n4️⃣ Up to 25 Booths — ₹25,000\n5️⃣ Up to 100 Booths — ₹50,000",
    "ta": "1 முதல் 5 வரை எண்ணை உள்ளிடவும்:\n\n1️⃣ 1 பூத் — ₹2,000\n2️⃣ 5 பூத் வரை — ₹5,000\n3️⃣ 10 பூத் வரை — ₹10,000\n4️⃣ 25 பூத் வரை — ₹25,000\n5️⃣ 100 பூத் வரை — ₹50,000"
  },
  "purchase_booth_ask": {
    "group": "purchase",
    "name": "Plan chosen — ask booth count",
    "when": "After a valid plan number",
    "vars": [
      "plan",
      "price"
    ],
    "en": "✅ *{plan} — {price}*\n\nHow many booths do you currently manage?\n_(Enter a number)_",
    "ta": "✅ *{plan} — {price}*\n\nநீங்கள் தற்போது எத்தனை பூத் பகுதிகளை நிர்வகிக்கிறீர்கள்?\n\n👉 பூத் எண்ணிக்கையை மட்டும் உள்ளிடவும்."
  },
  "purchase_pay_title": {
    "group": "purchase",
    "name": "Purchase: QR message title",
    "when": "Top of the QR message sent after the booth count (Purchase Plan)",
    "vars": [
      "booths"
    ],
    "en": "✅ *Your EDMS plan — {booths} booths*",
    "ta": "✅ *உங்கள் EDMS திட்டம் — {booths} பூத்கள்*"
  },
  "purchase_register_first": {
    "group": "purchase",
    "name": "Purchase: register first (not registered)",
    "when": "Added to the purchase QR message when the number has no EDMS account",
    "vars": [],
    "en": "📝 *Not registered yet? Register first (about 2 minutes)* so we can link your payment to your account:\n• *On WhatsApp:* tap *Main menu → Register* and follow the steps\n• *On the website:* https://tnedms.com/register\n\nThen pay with the QR above.",
    "ta": "📝 *இன்னும் பதிவு செய்யவில்லையா? முதலில் பதிவு செய்யுங்கள் (சுமார் 2 நிமிடங்கள்)* — உங்கள் கட்டணத்தை உங்கள் கணக்குடன் இணைக்க:\n• *வாட்ஸ்அப்பில்:* *முதன்மை மெனு → பதிவு செய்ய* என்பதைத் தட்டி படிகளைப் பின்பற்றவும்\n• *இணையதளத்தில்:* https://tnedms.com/register\n\nபின்னர் மேலே உள்ள QR மூலம் கட்டணம் செலுத்தவும்."
  },
  "social_invalid": {
    "group": "social",
    "name": "Service — wrong reply",
    "when": "Reply is not 1–3",
    "vars": [],
    "en": "Please reply with *1*, *2* or *3* to select a service:\n\n1️⃣ WA Broadcast\n2️⃣ Audio SMS\n3️⃣ SMS Broadcast",
    "ta": "1, 2 அல்லது 3 என்று உள்ளிடவும்:\n\n1️⃣ WA Broadcast (வாட்ஸ்அப் பரவல்)\n2️⃣ Audio SMS (ஒலி குறுஞ்செய்தி)\n3️⃣ SMS Broadcast (SMS பரவல்)"
  },
  "social_name_ask": {
    "group": "social",
    "name": "Ask name and party",
    "when": "After the service number",
    "vars": [
      "service"
    ],
    "en": "✅ *{service}* selected.\n\nYour *name and party*:",
    "ta": "✅ *{service}* தேர்ந்தெடுக்கப்பட்டுள்ளது.\n\nதயவுசெய்து உங்கள் *பெயர் மற்றும் கட்சி விவரங்களை* உள்ளிடவும்:"
  },
  "social_message_ask": {
    "group": "social",
    "name": "Ask for the message",
    "when": "After the name",
    "vars": [],
    "en": "📝 *Message or script* (Tamil/English):",
    "ta": "📝 *செய்தி / Script*\n\nதமிழ் / ஆங்கிலம் — இரண்டிலும் அனுப்பலாம்:"
  },
  "social_area_ask": {
    "group": "social",
    "name": "Ask for the target area",
    "when": "After the message",
    "vars": [],
    "en": "📍 *Target area* (district/ward):",
    "ta": "📍 *இலக்கு பகுதி*\n\nமாவட்டம் / சட்டமன்றத் தொகுதி / வார்டு:"
  },
  "social_done": {
    "group": "social",
    "name": "Request submitted",
    "when": "After the target area",
    "vars": [
      "service"
    ],
    "en": "✅ *Campaign Request Submitted!*\n\n📣 Service: *{service}*\n\nOur team will contact you within *4 hours* to confirm:\n• Target audience & area\n• Message approval\n• Pricing & schedule\n\n📞 *+91 79047 59268*",
    "ta": "✅ *உங்கள் பிரச்சார சேவை கோரிக்கை சமர்ப்பிக்கப்பட்டது!*\n\n📣 சேவை: *{service}*\n\nஎங்கள் குழு 4 மணி நேரத்திற்குள் உங்களைத் தொடர்புகொண்டு கீழ்க்கண்டவற்றை உறுதிப்படுத்தும்:\n• இலக்கு மக்கள் மற்றும் பகுதி\n• பிரச்சார செய்தி / உள்ளடக்கம்\n• கட்டணம் மற்றும் சேவை அட்டவணை\n\n📞 *+91 79047 59268*"
  },
  "proof_duplicate": {
    "group": "payment",
    "name": "Screenshot — UTR used by another account",
    "when": "Caption carries a UTR already approved for someone else",
    "vars": [
      "support_phone"
    ],
    "en": "⚠️ This UTR was already submitted from another account. Please check the number or contact support: {support_phone}",
    "ta": "⚠️ இந்த UTR எண் ஏற்கனவே வேறு கணக்கில் சமர்ப்பிக்கப்பட்டுள்ளது. உதவி: {support_phone}"
  },
  "pay_not_registered": {
    "group": "purchase",
    "name": "'pay' typed — not registered",
    "when": "Candidate types 'pay' before registering",
    "vars": [],
    "en": "Please register first before purchasing.\n\nType *Register* or select Register from the menu.",
    "ta": "வாங்குவதற்கு முன் முதலில் பதிவு செய்யவும்.\n\n*Register* என்று அனுப்பவும் அல்லது மெனுவில் *பதிவு செய்ய* என்பதைத் தேர்ந்தெடுக்கவும்."
  },
  "pay_already_active": {
    "group": "purchase",
    "name": "'pay' typed — already active",
    "when": "Candidate types 'pay' after being approved",
    "vars": [
      "mobile",
      "passcode"
    ],
    "en": "✅ Your EDMS subscription is already active!\n\n📲 Login at: https://tnedms.com/login\nUsername: `{mobile}`\nPasscode: `{passcode}`",
    "ta": "✅ உங்கள் EDMS கணக்கு ஏற்கனவே செயலில் உள்ளது!\n\n📲 உள்நுழைய: https://tnedms.com/login\nபயனர்பெயர்: `{mobile}`\nகடவுச்சொல்: `{passcode}`"
  },
  "pay_qr_title_pay": {
    "group": "payment",
    "name": "QR message title — after 'pay'",
    "when": "Heading of the QR message when the candidate types 'pay'",
    "vars": [],
    "en": "💰 *Complete Your Payment*",
    "ta": "💰 *கட்டணத்தை முடிக்கவும்*"
  },
  "pay_qr": {
    "group": "payment",
    "name": "QR message (caption under the QR)",
    "when": "After registration with booths, and when the candidate types 'pay'",
    "vars": [
      "title",
      "assembly_line",
      "booths",
      "base",
      "gst_rate",
      "total",
      "upi_id",
      "payee_name",
      "proof_line",
      "minutes"
    ],
    "image": "payment_qr",
    "en": "━━━━━━━━━━━━━━━━━━\n{title}\n\n{assembly_line}Booths: {booths}\nPlan: ₹{base} + {gst_rate}% GST\n*Total: ₹{total}*\n\n🏦 UPI ID: {upi_id}\n👤 {payee_name}\n\n📲 Scan the QR code above or pay directly to the UPI ID.\n\n{proof_line}\n\n⏱️ Your dashboard is activated within {minutes} minutes of verification.\n━━━━━━━━━━━━━━━━━━",
    "ta": "━━━━━━━━━━━━━━━━━━\n{title}\n\n{assembly_line}பூத் எண்ணிக்கை: {booths}\nதிட்டம்: ₹{base} + {gst_rate}% GST\n*மொத்தத் தொகை: ₹{total}*\n\n🏦 UPI ID: {upi_id}\n👤 {payee_name}\n\n📲 மேலே உள்ள QR குறியீட்டை ஸ்கேன் செய்து அல்லது UPI ID வழியாகக் கட்டணம் செலுத்தலாம்.\n\n{proof_line}\n\n⏱️ சரிபார்த்த {minutes} நிமிடங்களில் உங்கள் EDMS கணக்கு செயல்படுத்தப்படும்.\n━━━━━━━━━━━━━━━━━━"
  },
  "pay_qr_title": {
    "group": "payment",
    "name": "QR message title — after registration",
    "when": "Heading of the QR message sent after registration",
    "vars": [],
    "en": "🏆 Final Step to Secure Your Victory (வெற்றி உறுதி)",
    "ta": "🏆 வெற்றிக்கான கடைசிப் படி — கட்டண விவரங்கள்"
  },
  "pay_qr_assembly_line": {
    "group": "payment",
    "name": "QR message — assembly line",
    "when": "Inserted when the assembly is known",
    "vars": [
      "assembly"
    ],
    "en": "Assembly: {assembly}\n",
    "ta": "சட்டமன்றத் தொகுதி: {assembly}\n"
  },
  "pay_proof_chat": {
    "group": "payment",
    "name": "Proof instruction — send here in the chat",
    "when": "Payment setup: screenshot goes to the bot chat",
    "vars": [],
    "en": "📸 After payment:\nSend your payment screenshot *here in this chat*. We verify it and confirm.",
    "ta": "📸 கட்டணம் செலுத்திய பிறகு:\nஸ்கிரீன்ஷாட்டை *இந்தச் சாட்டிலேயே* அனுப்பவும். நாங்கள் சரிபார்த்து உறுதி செய்கிறோம்."
  },
  "pay_proof_number": {
    "group": "payment",
    "name": "Proof instruction — separate number",
    "when": "Payment setup: screenshot goes to a separate WhatsApp number",
    "vars": [
      "wa_link"
    ],
    "en": "📸 After payment:\nSend your payment screenshot to:\n👉 {wa_link}",
    "ta": "📸 கட்டணம் செலுத்திய பிறகு:\nஸ்கிரீன்ஷாட்டை இந்த எண்ணிற்கு அனுப்பவும்:\n👉 {wa_link}"
  },
  "proof_received": {
    "group": "payment",
    "name": "Screenshot received",
    "when": "Candidate sends the first screenshot",
    "vars": [
      "booths",
      "total",
      "utr_line",
      "minutes",
      "support_phone"
    ],
    "en": "✅ *Payment screenshot received!*\n\nBooths: *{booths}*\nExpected amount: *₹{total}*{utr_line}\n\n⏱️ Our team verifies it within {minutes} minutes and confirms here in this chat.\n\nHelp: {support_phone}",
    "ta": "✅ *உங்கள் கட்டண ஸ்கிரீன்ஷாட் கிடைத்தது!*\n\nபூத் எண்ணிக்கை: *{booths}*\nஎதிர்பார்க்கும் தொகை: *₹{total}*{utr_line}\n\n⏱️ எங்கள் குழு {minutes} நிமிடங்களில் சரிபார்த்து, இந்தச் சாட்டில் உறுதிப்படுத்தும்.\n\nஉதவி: {support_phone}"
  },
  "proof_received_more": {
    "group": "payment",
    "name": "Additional screenshot received",
    "when": "A second screenshot within 6 hours",
    "vars": [
      "booths",
      "total",
      "utr_line",
      "minutes",
      "support_phone"
    ],
    "en": "📸 Got the additional screenshot.\n\nBooths: *{booths}*\nExpected amount: *₹{total}*{utr_line}\n\n⏱️ Our team verifies it within {minutes} minutes and confirms here in this chat.\n\nHelp: {support_phone}",
    "ta": "📸 கூடுதல் ஸ்கிரீன்ஷாட் கிடைத்தது.\n\nபூத் எண்ணிக்கை: *{booths}*\nஎதிர்பார்க்கும் தொகை: *₹{total}*{utr_line}\n\n⏱️ எங்கள் குழு {minutes} நிமிடங்களில் சரிபார்த்து, இந்தச் சாட்டில் உறுதிப்படுத்தும்.\n\nஉதவி: {support_phone}"
  },
  "proof_unknown": {
    "group": "payment",
    "name": "Screenshot from an unregistered number",
    "when": "An image arrives from a number with no account",
    "vars": [],
    "en": "📸 We received an image, but there is no EDMS registration under this number.\n\nPlease tap *Register* first. After registering you can send the payment screenshot here.",
    "ta": "📸 ஒரு படம் கிடைத்தது, ஆனால் இந்த எண்ணில் EDMS பதிவு இல்லை.\n\nமுதலில் *பதிவு செய்ய* என்பதைத் தேர்ந்தெடுத்துப் பதிவு செய்யவும். பதிவுக்குப் பிறகு கட்டண ஸ்கிரீன்ஷாட்டை இங்கே அனுப்பலாம்."
  },
  "proof_already_paid": {
    "group": "payment",
    "name": "Screenshot from a paid account",
    "when": "An image arrives from an already-approved candidate",
    "vars": [],
    "en": "✅ Your EDMS subscription is already active!\n\n📲 Login at: https://tnedms.com/login",
    "ta": "✅ உங்கள் EDMS கணக்கு ஏற்கனவே செயலில் உள்ளது!\n\n📲 உள்நுழைய: https://tnedms.com/login"
  },
  "proof_approved": {
    "group": "payment",
    "name": "Payment approved",
    "when": "Admin approves on the Payments page",
    "vars": [
      "name_prefix",
      "booths",
      "amount",
      "mobile"
    ],
    "en": "🎉 *Payment confirmed!*\n\n{name_prefix}your EDMS subscription is now active.\n\nBooths: *{booths}*\nAmount received: *₹{amount}*\n\n📲 Login at: https://tnedms.com/login\n🔑 Username: `{mobile}`\n\nAll the best! ✌️",
    "ta": "🎉 *கட்டணம் உறுதி செய்யப்பட்டது!*\n\n{name_prefix}உங்கள் EDMS கணக்கு இப்போது செயலில் உள்ளது.\n\nபூத் எண்ணிக்கை: *{booths}*\nபெறப்பட்ட தொகை: *₹{amount}*\n\n📲 உள்நுழைய: https://tnedms.com/login\n🔑 பயனர்பெயர்: `{mobile}`\n\nவாழ்த்துகள்! ✌️"
  },
  "proof_rejected": {
    "group": "payment",
    "name": "Payment rejected",
    "when": "Admin rejects on the Payments page",
    "vars": [
      "reason_line",
      "support_phone"
    ],
    "en": "⚠️ *We could not verify this payment.*{reason_line}\n\nPlease send a clear screenshot of the payment from your UPI app (UTR number visible) here again.\n\nHelp: {support_phone}",
    "ta": "⚠️ *கட்டணத்தை உறுதி செய்ய முடியவில்லை.*{reason_line}\n\nதயவுசெய்து UPI ஆப்பில் உள்ள கட்டண விவரத்தின் தெளிவான ஸ்கிரீன்ஷாட்டை (UTR எண் தெரியும்படி) மீண்டும் இங்கே அனுப்பவும்.\n\nஉதவி: {support_phone}"
  },
  "feat_pay_register_first": {
    "group": "features",
    "name": "Pay Now / Pay Later — no account",
    "when": "A Pay Now or Pay Later button is tapped by a number without an EDMS account",
    "vars": [],
    "en": "Please register first.\n\nSend *Hi* and choose *Register*.",
    "ta": "முதலில் பதிவு செய்யவும்.\n\n*Hi* என அனுப்பி *பதிவு செய்ய* என்பதைத் தேர்ந்தெடுக்கவும்."
  },
  "feat_pay_already_active": {
    "group": "features",
    "name": "Pay Now / Pay Later — already paid",
    "when": "A Pay Now or Pay Later button is tapped by a paid account",
    "vars": [],
    "en": "✅ Your EDMS plan is already active.\n\n📲 Login: https://tnedms.com/login",
    "ta": "✅ உங்கள் EDMS திட்டம் ஏற்கனவே செயல்பாட்டில் உள்ளது.\n\n📲 உள்நுழைய: https://tnedms.com/login"
  },
  "feat_pay_later_ask": {
    "group": "features",
    "name": "Pay Later — when?",
    "when": "The Pay Later button is tapped (the answer pauses reminders for 48 hours)",
    "vars": [],
    "en": "No problem. 🙏 When would you like to make the payment?\n\nReply with a day or a date (for example: *Monday evening*).",
    "ta": "பரவாயில்லை. 🙏 எப்போது கட்டணம் செலுத்த விரும்புகிறீர்கள்?\n\nஒரு நாள் அல்லது தேதியைப் பதிலாக அனுப்பவும் (எ.கா. *திங்கள் மாலை*)."
  },
  "feat_pay_later_thanks": {
    "group": "features",
    "name": "Pay Later — answer noted",
    "when": "After they say when they will pay",
    "vars": [
      "answer"
    ],
    "en": "✅ Thank you! We have noted: \"{answer}\".\n\nWe will remind you again in 2 days. To pay any time, reply *Pay Now*.",
    "ta": "✅ நன்றி! குறித்துக்கொண்டோம்: \"{answer}\".\n\n2 நாட்களில் மீண்டும் நினைவூட்டுவோம். எப்போது வேண்டுமானாலும் செலுத்த *இப்போது செலுத்த* என பதிலளிக்கவும்."
  },
  "feat_stop_done": {
    "group": "features",
    "name": "STOP — reminders stopped",
    "when": "They reply STOP / unsubscribe / நிறுத்து",
    "vars": [],
    "en": "✅ Done. You will not get EDMS reminders on WhatsApp any more.\n\nYou can still use the menu any time — send *Hi*.",
    "ta": "✅ சரி. இனி EDMS நினைவூட்டல்கள் வாட்ஸ்அப்பில் அனுப்பப்படாது.\n\nமெனுவை எப்போது வேண்டுமானாலும் பயன்படுத்தலாம் — *Hi* என அனுப்பவும்."
  },
  "feat_login_no_account": {
    "group": "features",
    "name": "Website login — no account",
    "when": "The ready message from the website arrives from a number without an account",
    "vars": [
      "mobile"
    ],
    "en": "⚠️ No EDMS account was found for *{mobile}*.\n\nRegister at https://tnedms.com/register with this WhatsApp number, or send *Hi* to register here.",
    "ta": "⚠️ *{mobile}* என்ற எண்ணுக்கு EDMS கணக்கு கண்டறியப்படவில்லை.\n\nஇதே வாட்ஸ்அப் எண்ணுடன் https://tnedms.com/register இல் பதிவு செய்யவும், அல்லது இங்கே பதிவு செய்ய *Hi* என அனுப்பவும்."
  },
  "feat_login_sent": {
    "group": "features",
    "name": "Website login — the login",
    "when": "Reply to the ready message from the website (caption under the credentials image; the QR follows if unpaid)",
    "vars": [
      "mobile",
      "passcode"
    ],
    "image": "credentials",
    "en": "🔑 *Your EDMS login*\n\n📱 Username: {mobile}\n🔒 Passcode: {passcode}\n\n📲 Login: https://tnedms.com/login\n\n⚠️ Keep your passcode confidential.",
    "ta": "🔑 *உங்கள் EDMS உள்நுழைவு விவரங்கள்*\n\n📱 பயனர்பெயர்: {mobile}\n🔒 கடவுச்சொல்: {passcode}\n\n📲 உள்நுழைய: https://tnedms.com/login\n\n⚠️ உங்கள் கடவுச்சொல்லை யாருடனும் பகிர வேண்டாம்."
  }
};

export const BOT_IMAGES = {
  "credentials": {
    "name": "Credentials header",
    "when": "Sent with My Credentials and Welcome back",
    "url": "https://res.cloudinary.com/ajp3dslc/image/upload/v1791185746/edms-bot/edms-credentials.jpg"
  },
  "registration_complete": {
    "name": "Registration complete header",
    "when": "Sent with the registration-complete message",
    "url": "https://res.cloudinary.com/ajp3dslc/image/upload/v1791185730/edms-bot/edms-registration-complete.jpg"
  }
};
