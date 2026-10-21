// Where the master sheet lives. The sheet ID can be overridden with the SHEET_ID environment variable on the server.
export const DEFAULT_SHEET_ID = "1LQdSkcYGab2hwWQiqDqVRH866Babjqx9R1Mh65IovjY";

/** Tab name -> Google Sheets gid (the number after "gid=" in the tab's URL). */
export const TABS = {
  Location: 1989301397,
  Master: 2113521515,
  Size: 1714413439,
  StonePrice: 0,
  SettingRates: 349999690,
  LaborPolicy: 350792109,
  CastingRates: 1419726178,
  MetalMaster: 1764639411,
  AlloyMaster: 126380907,
  LabelAs: 2142773516,
};
export const OPTIONAL_TABS = ["LabelAs"];
