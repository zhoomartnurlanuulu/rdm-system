// Shared application state — single source of truth
export const API = '';
export const PER_PAGE = 9;

export const state = {
  currentUser: null,
  pubToken: sessionStorage.getItem('rdm-pub-token') || null,
  allDatasets: [],
  filtered: [],
  page: 1,
  totalPages: 1,
  totalCount: 0,
};
