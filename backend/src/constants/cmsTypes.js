// Mirrors the mobileapp\* controllers/models — each CMS content type maps to a
// MongoDB collection in the app DB, with its own created/updated timestamp fields.
export const CMS_TYPES = {
  news:            { collection: 'app_news',                created: 'created_on',   updated: 'updated_on',   label: 'News' },
  events:          { collection: 'app_event',               created: 'created_on',   updated: 'updated_on',   label: 'Events' },
  gallery:         { collection: 'photo_gallery',           created: 'created_on',   updated: 'updated_on',   label: 'Photo Gallery' },
  katchi:          { collection: 'app_katchi_background',   created: 'created_on',   updated: 'updated_on',   label: 'Katchi Background' },
  history:         { collection: 'app_history',             created: 'created_on',   updated: 'updated_on',   label: 'History' },
  policy:          { collection: 'app_policy',              created: 'created_on',   updated: 'updated_on',   label: 'Policy' },
  'social-service':{ collection: 'app_social',              created: 'created_on',   updated: 'updated_on',   label: 'Social Service' },
  achieve:         { collection: 'app_achieve',             created: 'created_on',   updated: 'updated_on',   label: 'Achievements' },
  video:           { collection: 'app_video',               created: 'created_date', updated: 'modified_date',label: 'Video' },
  radio:           { collection: 'radio',                   created: 'created_date', updated: 'modified_date',label: 'Radio' },
  share:           { collection: 'tbl_invite_content',      created: 'created_date', updated: 'updated_date', label: 'Share Content' },
  hometitle:       { collection: 'tbl_home',                created: null,           updated: null,           label: 'Home Title' },
  slidemenu:       { collection: 'app_slide_menu_photos',   created: 'created_date', updated: 'modified_date',label: 'Slide Menu' },
};

export const cmsType = (t) => CMS_TYPES[t] || null;
