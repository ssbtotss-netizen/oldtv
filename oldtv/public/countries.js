// All countries (ISO 3166-1 alpha-2). Arabic names come from the browser (Intl.DisplayNames).
window.OLDTV_COUNTRIES = (() => {
  const ARAB = ['SA','AE','KW','QA','BH','OM','YE','IQ','JO','SY','LB','PS','EG','SD','LY','TN','DZ','MA','MR','SO','DJ','KM'];
  const ALL = ('AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI XK KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PS PA PG PY PE PH PL PT PR QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW').split(' ');
  let dn = null;
  try { dn = new Intl.DisplayNames(['ar'], { type: 'region' }); } catch (_) {}
  const name = (c) => {
    try { return (dn && dn.of(c)) || c; } catch (_) { return c; }
  };
  const others = ALL.filter((c) => !ARAB.includes(c))
    .map((c) => [c, name(c)])
    .sort((a, b) => a[1].localeCompare(b[1], 'ar'));
  return { arab: ARAB.map((c) => [c, name(c)]), others, name };
})();
