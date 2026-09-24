import type {
  BrochurePackageSeed,
  PackageRateTierSeed,
  PackageVariantSeed,
  PackageWeekday,
} from './packageCatalogueSeed';

/**
 * The Three Pyramids brochure catalogue: 25 tours (T001-T025) and 17 packages
 * (P01-P17), transcribed from the hotel's own brochure, which is the single
 * authoritative source for this data.
 *
 * Every value here is brochure-supported. Nothing is inferred from a
 * neighbouring page, and nothing is carried over from the superseded
 * `apps/web/features/packages/data/packagesDemoData.ts`, whose own header
 * states its content was illustrative and must not be published.
 *
 * Transcription rules, applied uniformly:
 *
 * - Money is normalised into the database's decimal-string syntax only, never
 *   revalued: `US$104,00` -> `"104.00"` (the brochure's decimal comma is a
 *   typographic slip), `US$143` -> `"143.00"` (implied cents), `US$ 104.00` ->
 *   `"104.00"` (stray space). All amounts are USD.
 * - Prose keeps the brochure's own wording, including its spelling and
 *   punctuation slips ("necropoils", "resturant", "Evey day anytime"). Only
 *   PDF line wrapping is collapsed. Correcting the copy would be an editorial
 *   decision the hotel has not made.
 * - `1 Person` / `2 Person` / `+3 Person` become [1,1], [2,2], [3,unbounded].
 *   The brochure states no upper bound, so none is invented.
 * - `Children (6-12yrs.) 50%` becomes 6 / 12 / "50.00". Where a page shows no
 *   child column the three fields stay null, and the reservation service then
 *   treats a party containing children as requiring confirmation rather than
 *   pricing them from an assumed rule.
 * - A page with no `Run:` line gets `operatingDays: null`, which the domain
 *   reads as "no stated weekday restriction" rather than as a fabricated week.
 *
 * The schema requires every sellable product to carry at least one variant.
 * Where the brochure offers no choice, that structural requirement is met by a
 * single `standard` variant; the brochure's own options are used verbatim
 * wherever it does offer a choice (T016's two service options, P16/P17's cabin
 * types).
 */

const EVERY_DAY: PackageWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/** `Children (6-12yrs.) 50%`, the only child rule the brochure ever states. */
const CHILD_6_TO_12_HALF_PRICE = {
  childMinAge: 6,
  childMaxAge: 12,
  childDiscountPercent: '50.00',
} as const;

/** No child column on the page. Never a stand-in for an unstated rule. */
const NO_CHILD_RULE = {
  childMinAge: null,
  childMaxAge: null,
  childDiscountPercent: null,
} as const;

/** The brochure's `1 Person` / `2 Person` / `+3 Person` columns. */
function partySizeTiers(one: string, two: string, threeOrMore: string): PackageRateTierSeed[] {
  return [
    { minPartySize: 1, maxPartySize: 1, adultUnitRate: one },
    { minPartySize: 2, maxPartySize: 2, adultUnitRate: two },
    // Unbounded: the brochure caps `+3 Person` at no number.
    { minPartySize: 3, maxPartySize: null, adultUnitRate: threeOrMore },
  ];
}

/**
 * The single variant a product carries when the brochure offers no choice.
 * `standard` is structural scaffolding for the schema's variant requirement,
 * not a brochure term, which is why it claims nothing about the product.
 */
function soleVariant(
  rates: PackageRateTierSeed[],
  child: typeof CHILD_6_TO_12_HALF_PRICE | typeof NO_CHILD_RULE,
): PackageVariantSeed[] {
  return [{ key: 'standard', label: 'Standard', isDefault: true, ...child, rates }];
}

/** The note every 4x4 desert package carries, verbatim. */
const FOUR_BY_FOUR_CAPACITY_NOTE =
  'Maximum 4 people per 4 x 4 Car. For excursions with more than 4 persons, please contact us.';

const ALCOHOL_EXCLUSION = 'Alcoholic beverages not included.';

const PROGRAM_DAYS_CHANGEABLE_NOTE =
  'The days of the program of our private tours packages can be changed as desired. For example, you can start your package with day 2 instead of day 1 etc.';

export const BROCHURE_PACKAGE_CATALOGUE: BrochurePackageSeed[] = [
  {
    code: 'T001',
    slug: 'tour-to-giza-pyramids-and-sphinx',
    title: 'Tour to Giza Pyramids and Sphinx',
    summary: null,
    description:
      "Your tour guide will pick you up from the hotel, to visit the Pyramids of Cheops, Chephren and Mykerinus. Then proceed to visit the Great Sphinx, the head of a pharaoh with a lion's body, dates from the time of Chephren. The tour also includes a visit to the Valley Temple which belongs to the Pyramids of Chephren. This temple served definitely two functions: First, it was used for the purification of the mummy of the king before its burial. Second, it was used for making the Mummification process of the king.",
    durationLabel: 'Approx. 2hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from the hotel & return' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites' },
      { kind: 'included', text: 'All taxes & service charge' },
    ],
    variants: soleVariant(partySizeTiers('104.00', '92.00', '78.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T002',
    slug: 'tour-to-pyramids-sakkara-and-dahshur',
    title: 'Tour to Pyramids, Sakkara and Dahshur',
    summary: null,
    description:
      "your private tour guide will pick you up from the hotel, to start your day tour visiting the Red Pyramid & Bent Pyramid at Dahshur, Dahshur is a famous royal necropoils in Egypt holds many famous Pyramids includes the red & bent Pyraimds of king snefru. it's about 40km from Cairo. Move on to visit the Step Pyramid of Zoser, the world's oldest major stone structure. It was built in the 3rd Dynasty (around 2630 BC) for King Djoser. Lunch will be served at a local restaurant, before moving on to enjoy an excursion to The Pyramids of Cheops, Chephren and Mykerinus. Continue on to visit the Great Sphinx which dates back to the time of Chephren; the tour also includes a visit to the Valley Temple, which belongs to the Pyramids of Chephren.",
    durationLabel: 'Approx. 8hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel & return.' },
      { kind: 'included', text: 'Private tour guide.' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites.' },
      { kind: 'included', text: 'All taxes & service charge.' },
      { kind: 'included', text: 'Lunch in a local resturant' },
    ],
    // The brochure prints the 2-person and 3+ rates without cents.
    variants: soleVariant(partySizeTiers('182.00', '143.00', '124.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T003',
    slug: 'tour-to-pyramids-memphis-and-sakkara',
    title: 'Tour to Pyramids, Memphis and Sakkara',
    summary: null,
    description:
      "You will be picked up from your hotel by our tours representative, to enjoy a great excursion to The Pyramids of Cheops, Chephren and Mykerinus. Then proceed to visit the Great Sphinx, which dates back to the time of Chephren and visit to the Valley Temple. Move to visit the Step Pyramid of Zoser, the world's oldest major stone structure. It was built in the 3rd Dynasty for King Djoser. Then Proceed to have your lunch at local restaurant. After that transfer to emphis which was founded by King Menes, and was the capital of Egypt during the Old Kingdom, it was considered to be a center of rule and culture for over 3000 years the first capital of Egypt, and see the Statue of Ramses II and the alabaster Sphinx of Memphis.",
    durationLabel: 'Approx.8 hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel & return.' },
      { kind: 'included', text: 'Private tour guide.' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites.' },
      { kind: 'included', text: 'All taxes & service charge.' },
      { kind: 'included', text: 'Lunch in a local resturant' },
    ],
    variants: soleVariant(partySizeTiers('182.00', '143.00', '124.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    // The brochure headline is cut off in the source document itself
    // ("...around The Pyra"). The visible text is stored verbatim rather than
    // completed, and the slug avoids the missing word entirely, so neither
    // depends on a guess. The final business title is pending confirmation
    // from the hotel.
    code: 'T004',
    slug: 'desert-safari-quad-bike',
    title: 'Desert Safari: Quad Bike around The Pyra',
    summary: null,
    description:
      'Three Pyramids Tours representative will pick you up from the hotel to enjoy the only place in Egypt where you can experience the wonders of the ancient world through the quad bike tour experience with a panoramic view of the Pyramids of Cheops, Chephren and Mykerinus. What is unique about this tour is getting there is half the fun, Being there near the great pyramids of giza enjoying the adventure of quadbike.',
    durationLabel: 'Approx. 2hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel in Cairo and return' },
      { kind: 'included', text: 'Riding quad bike for about 2 hours' },
      { kind: 'included', text: 'All Service charges & taxes' },
      { kind: 'included', text: 'Safari scarf' },
    ],
    variants: soleVariant(partySizeTiers('104.00', '92.00', '85.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T005',
    slug: 'horse-camel-ride-around-the-pyramids',
    title: 'Horse / Camel ride around The Pyramids',
    summary: null,
    description:
      'Have you ever been in a discovery tour in the desert? Try a horse or a camel riding at Giza Pyramids for 2 hours during the sun rise or sun set. While experiencing the camel or horse ride, you will enjoy the fascinating view of the pyramids of Cheops, Chephren and Mykerinus from outside. The Great Pyramids are considered as the oldest one of the seven wonders of the Ancient World, tallest man-made structure in the world for over 3,800 years and the most important touristic sites in Egypt.',
    durationLabel: 'Approx. 2hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel & return' },
      { kind: 'included', text: 'A horse or Camel riding for 2 hours' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'All taxes & service charge' },
      { kind: 'included', text: 'Safari scarf' },
    ],
    variants: soleVariant(partySizeTiers('104.00', '91.00', '85.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T006',
    slug: 'egyptian-museum-citadel-and-old-cairo',
    title: 'Egyptian Museum, Citadel and Old Cairo',
    summary: null,
    description:
      "The Egyptian Museum displays a rare collection of 5000 years of art which is considered the largest most precious collection of Egyptian art in the world. Over 250,000 overwhelming artifacts are presented, including an exhibit dedicated to Tutankhamen collection of treasure, gold and jewelry which was enclosed in his tomb for over 3,500 years before it was discovered in the 1920s when his tomb was excavated. Then proceed to visit Mohamed Ali Alabaster Mosque inside the Citadel of Salah El Din . Lunch will be served in a local restaurant. Continue driving to the area of Islamic Cairo, where you will be able to explore Khan El Khalili, Cairo's old bazaar. Then we move on to Coptic Cairo to visit theHanging Church, Ben Ezra Synagogue, Church of St. Barbara, Church of Abu Serga. Later you will be transferred Back to your hotel.",
    durationLabel: 'Approx. 5hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel & return' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites' },
      { kind: 'included', text: 'All taxes & service charge' },
      { kind: 'included', text: 'Lunch in a local resturant' },
    ],
    variants: soleVariant(partySizeTiers('182.00', '152.00', '117.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T007',
    slug: 'civilization-museum-citadel-and-old-cairo',
    title: 'Civilization Museum Citadel and Old  Cairo',
    summary: null,
    description:
      "You will start your day with our guide to see our newsiest museum opened on 3 April 2021, the museum was officially opened right before the moving of 22 mummies, including 18 kings and four queens, from the Egyptian Museum in an event termed the Pharaohs' Golden Parade ,will display a collection of 50,000 artefacts, presenting Egyptian civilization from prehistoric times to the present day. You will see the Miricale the pharaonic did saving the buddy and the quality of the material they use that will make you surprised then the guide will take you to the old Cairo Street to see the other side of the history of Egypt, then the time to take a rest in one of our local restaurants then to the Citadel and what Mohamed Ali effect in Egypt .",
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel & return' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites' },
      { kind: 'included', text: 'All taxes & service charge' },
      { kind: 'included', text: 'Lunch in a local resturant' },
    ],
    variants: soleVariant(partySizeTiers('182.00', '152.00', '117.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T008',
    slug: 'day-tour-to-alexandria',
    title: 'Day Tour to Alexandria',
    summary: null,
    description:
      "Three Pyramids Tours representative will pick you up from the hotel, and then transfer to enjoy amazing day trip to Alexandria. First visit Pompay's Pillar. It was constructed in honor of the Emperor Diocletian at the end of the 4th century. Originally from the temple of the Serapis, it was once a magnificent structure rivaling the Soma and the Caesarean. Then you drive to visit the Catacombs which are the largest Roman Cemetery consisting of three levels cut in the rock. Lunch at local restaurant in Alexandria, and then we proceed to see the Qaitbay Citadel which was built on the site of the ancient pharaohs (lighthouse) of Alexandria then to Bibliotheca Alexandrina.",
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel in Cairo & return' },
      { kind: 'included', text: 'Entrance fees to the mentioned historical place' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'All taxes & service charge' },
      { kind: 'included', text: 'Lunch in a local resturant' },
    ],
    variants: soleVariant(partySizeTiers('227.00', '188.00', '156.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T009',
    slug: 'day-tour-to-el-fayoum-oasis',
    title: 'Day Tour to El Fayoum Oasis',
    summary: null,
    description:
      "From Cairo to Fayoum is about 95km. Wadi El Ryan, designated as a Protected Area in 1989. We will start our tour to Wadi Hitan Protected Area (Valley of the Whales), about 90km far from Fayoum. Wadi Hitan is located in the Protected Area of Wadi El Rayan and it was designated by UNISCO as a world Heritage Site in recognition of the 40 million year – old whale skeletons found there. On the way to Wadi El Rayan Water Falls, visit Mudawara Mountain. Then Wadi Al Ryan Water Falls. a natural depression located in Western Desert, 42m below sea level. Wadi Al Rayan consists of two lakes connected by Egypt's only waterfalls, formed in 1970 by an overflow of drainage water from the farmlands in Fayoum. After that enjoy Medinet Madi (Ancient City Uncovered) which dates back to the third pharaonic dynasty built by Amenemhet III and completed Amenemhet IV.",
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel & return.' },
      { kind: 'included', text: 'Private tour guide.' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites.' },
      { kind: 'included', text: 'All taxes & service charge.' },
      { kind: 'included', text: 'Lunch in a local resturant' },
    ],
    variants: soleVariant(partySizeTiers('364.00', '247.00', '221.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    // One price for any party size: the brochure prints a single `Price` cell
    // rather than the usual 1/2/+3 columns, so this is one unbounded tier.
    code: 'T010',
    slug: 'cairo-nile-dinner-cruise-and-show',
    title: 'Cairo Nile Dinner Cruise and Show',
    summary: null,
    description:
      "It is a fabulous way to enjoy a night on the Nile while you are in Cairo. So, you are invited to dinner on Nile cruising restaurant for two hours sailing trip on the Nile with belly dancer, folklore show, Oriental music and dinner. All the time, you'll be delighted in our Chef's menu along with a selection of Egyptian favorites, made with the freshest ingredients, and prepared to make it a memorable dining experience.",
    durationLabel: 'Approx. 3hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel & return' },
      { kind: 'included', text: 'Open buffet' },
      { kind: 'included', text: 'Oriental Show' },
      { kind: 'included', text: 'Belly dancing show' },
      { kind: 'included', text: 'All taxes & service charge' },
    ],
    variants: soleVariant(
      [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '91.00' }],
      NO_CHILD_RULE,
    ),
  },
  {
    code: 'T011',
    slug: 'cairo-tower-and-dinner',
    title: 'Cairo Tower and Dinner',
    summary: null,
    description:
      "Our private car will pick you from the hotel to enjoy your dinner from the highest point of Egypt , the Cairo Tower consider as the tallest structure in Egypt and North Africa. One of Cairo's well-known modern monuments, sometimes considered Egypt's second most famous landmark after the Pyramids of Giza is consider one of the most prominent features of the Egyptian capital . Its partially open lattice-work design is intended to evoke a lotus plant so you will take a unique photos",
    durationLabel: null,
    // Printed as loose copy rather than in the brochure's `Run:` field, and
    // carrying a typo, so the text is preserved but no weekday set is derived
    // from it. Unrestricted either way at runtime.
    scheduleLabel: 'Evey day anytime',
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel & return' },
      { kind: 'included', text: 'Lunch or dinner depends to your choice' },
      { kind: 'included', text: 'All taxes & services charge' },
    ],
    variants: soleVariant(partySizeTiers('104.00', '91.00', '78.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T012',
    slug: 'bedouin-dinner',
    title: 'Bedouin Dinner',
    summary: null,
    description:
      'Whenever you travel to any country in the world we are always looking for food. So we will take you to eat the best egyptian food and discover the Bedouin life and we will drink the egyptian tea under the arm of the galaxy, the stars and the clear at night.',
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel & return' },
      { kind: 'included', text: 'Lunch or dinner depends to your choice' },
      { kind: 'included', text: 'All taxes & services charge' },
      { kind: 'included', text: 'Fire Show,Dj and Tanuwrat Show' },
      { kind: 'included', text: 'Dinner and Soft Drinks.' },
    ],
    variants: soleVariant(partySizeTiers('98.00', '85.00', '72.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T013',
    slug: 'cairo-by-night-khan-el-khalili',
    title: 'Cairo by Night-Khan El khalili',
    summary: null,
    description:
      'Whenever you travel to any country in the world we are always looking for that corner shop store or authentic market place. Such Marketplaces and bazaars not only serve as a place of livelihood but a Venue worthy of Exploration and filled with so meticulous and rare yet extremely beautiful and Inspiring crafts, Exotic Spices and so Much more. Khan el Khalili bazaar is a Beautifully authentic part of Cairo and one of the oldest Markets in Egypt & an unmissable Part of most Egypt Tour Packages or Nile Cruise. Little is known about this unique market, its origins, what it is and the crucial role it serves not just as a meeting place for the locals but one of the best tourist venues in Egypt',
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel & return' },
      { kind: 'included', text: 'Private guide' },
      { kind: 'included', text: 'All taxes & services charge' },
      { kind: 'included', text: 'Lunch or dinner depends to your choice' },
    ],
    variants: soleVariant(partySizeTiers('91.00', '78.00', '65.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T014',
    slug: 'day-in-malls',
    title: 'Day in Malls',
    summary: null,
    description:
      "You will enjoy a shopping day in one of the biggest malls we have , you will be able to chose between Mall of Egypt or Mall of Arabia , with a private transportation with premium local and international brands under one roof. Envisaged as a family destination and an ideal opportunity for social interaction at the Mall's Park an entertaining cinema-plex, as well as Billy Beez, Flip-out & Bricks City for kids to play safely, as parents shop or dine.",
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel & return' },
      { kind: 'included', text: 'Private guide' },
      { kind: 'included', text: 'All taxes & services charge' },
    ],
    variants: soleVariant(partySizeTiers('78.00', '65.00', '52.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T015',
    slug: 'tour-to-camel-market-of-birqash',
    title: 'Tour to Camel Market of Birqash',
    summary: null,
    description:
      'Birqash, a small village north of Cairo to visit the famous Camel Market. You will enjoy a unique experience while seeing merchants buying and selling camels in auctions inside the market, and watch the traders negotiating and making deals. People from every social standard and also traders go there to get a relatively cheap and guaranteed healthy meat. Also foreign tourists from all over the world come to this famous market, because they are keen after watching the Pharaonic monuments to see the largest gathering of camels.',
    durationLabel: 'Approx. 4hrs.',
    scheduleLabel: 'Every Friday & Sunday',
    operatingDays: ['friday', 'sunday'],
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel & return' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'Entrance fees to the Camel Market & Camera ticket' },
      { kind: 'included', text: 'All taxes & services charge' },
    ],
    variants: soleVariant(partySizeTiers('91.00', '78.00', '65.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    // Two service options, each with its own single price. The brochure names
    // no preferred option, so neither variant is marked default and the guest
    // is required to choose.
    code: 'T016',
    slug: 'cafelucca-ride-on-the-nile-in-cairo',
    title: 'Cafelucca Ride on The Nile In Cairo',
    summary: null,
    description:
      'Enjoy a relaxing experience of a cafelucca ride in the River Nile, where you can discover the amazing view of Cairo at night or enjoy the sunrise and the warm sun during the day. not only this We can also arrange your birthday party while sailing across the Nile.',
    durationLabel: 'Approx. 4hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel & return' },
      { kind: 'included', text: 'Felucca ride on the Nile for two hours' },
      { kind: 'included', text: 'All taxes & service charge' },
    ],
    variants: [
      {
        key: 'lunch-or-dinner-included',
        label: 'Lunch or Dinner Included',
        isDefault: false,
        ...NO_CHILD_RULE,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '110.00' }],
      },
      {
        key: 'only-drinks-included',
        label: 'Only Drinks Included',
        isDefault: false,
        ...NO_CHILD_RULE,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '98.00' }],
      },
    ],
  },
  {
    code: 'T017',
    slug: 'day-tour-to-wadi-el-natroun-monastery',
    title: 'Day Tour to Wadi El Natroun Monastery',
    summary: null,
    description:
      'Wadi El-Natrun, the actual birthplace for Christian monasticism. Basically, there were about 50 monasteries, only 4 have survived into modern times. Begin your trip with Deir al-Baramus which is the oldest of the surviving 4 monasteries, and in many ways the most isolated, then proceeds to Deir Anba Bishoi whose body is still in the monastery. End your trip visiting Deir El-Suryani which is the smallest and most compact of the 4 monasteries.',
    durationLabel: 'Approx. 8hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from hotel & return' },
      { kind: 'included', text: 'Entrance fees to the mentioned historical place' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'All taxes & service charge' },
    ],
    variants: soleVariant(partySizeTiers('163.00', '117.00', '104.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T018',
    slug: 'memphis-and-sakkara-tour',
    title: 'Memphis and Sakkara Tour',
    summary: null,
    description:
      "The Step Pyramid of Zoser, the world's oldest major stone structure. It was built in the 3rd Dynasty for King Djoser. After that transfer to Memphis which was founded by King Menes, it was the capital of Egypt during the Old Kingdom, considered to be a center of rule and culture for over 3000 years the first capital of Egypt, and see the Statue of amses II and the alabaster Sphinx of Memphis.",
    durationLabel: 'Approx. 4hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel & return' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites' },
      { kind: 'included', text: 'All taxes & service charge' },
    ],
    variants: soleVariant(partySizeTiers('152.00', '124.00', '104.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T019',
    slug: 'memphis-sakkara-and-dahshur-tour',
    title: 'Memphis, Sakkara and Dahshur Tour',
    summary: null,
    description:
      "The Step Pyramid of Zoser, the world's oldest major stone structure. It was built in the 3rd Dynasty for King Djoser. After that transfer to Memphis which was founded by King Menes, and was the capital of Egypt during the Old Kingdom, it was considered to be a center of rule and culture for over 3000 years the first capital of Egypt, and see the Statue of Ramses II and the alabaster Sphinx of Memphis, Then visiting the Red Pyramid and Bent Pyramid at Dahshur, Dahshur is a famous royal necropoils in Egypt holds many famous Pyramids includes the red and bent Pyraimds of king snefru. The site is about 40 km from Cairo.",
    durationLabel: 'Approx. 6hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel & return' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites' },
      { kind: 'included', text: 'All taxes & service charge' },
    ],
    variants: soleVariant(partySizeTiers('169.00', '152.00', '124.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T020',
    slug: 'tour-to-pyramids-and-egyptian-museum',
    title: 'Tour to Pyramids & Egyptian Museum',
    summary: null,
    description:
      'Pyramids Tours representative will pick you up from the hotel, to enjoy an excursion to The Pyramids of Cheops, Chephren and Mykerinus. Then proceed to visit the Great Sphinx, which dates from the time of Chephren; the tour also includes a visit to the Valley Temple, which belongs to the pyramid of chefren. Then have your lunch at local restaurant and Move to visit the Egyptian Museum, which features artifacts from the Pharaonic period. The museum displays a rare collection of 5000 years of art which is considered the largest precious collection. Over 250,000 genuine artifacts are presented, including an exhibit dedicated to Tutankhamen collection of treasure, gold and jewelry which was enclosed in his tomb for over 3,500 years before it was discovered in the 1920s when his tomb was discovered.',
    durationLabel: 'Approx. 8hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from the hotel & return.' },
      { kind: 'included', text: 'Private Tour guide.' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites.' },
      { kind: 'included', text: 'Lunch meal at local restaurant in Cairo.' },
      { kind: 'included', text: 'All taxes & service charge.' },
    ],
    variants: soleVariant(partySizeTiers('169.00', '152.00', '124.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T021',
    slug: 'tour-to-the-egyptian-museum',
    title: 'Tour to The Egyptian Museum',
    summary: null,
    description:
      'Three Pyramids Tours Representative will pick you up to visit the Egyptian Museum, which features artifacts from the Pharaonic period. The museum displays a rare collection of 5000 years of art which is considered the largest most precious collection of Egyptian art in the world. Over 250,000 genuine artifacts are presented, including an exhibit dedicated to Tutankhamen collection of treasure, gold and jewelry which was enclosed in his tomb for over 3,500 years before it was discovered in the 1920s when his tomb was discovered. Back to hotel after your trip.',
    durationLabel: 'Approx. 4hrs.',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel & return' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites' },
      { kind: 'included', text: 'All taxes & service charge' },
    ],
    variants: soleVariant(partySizeTiers('98.00', '85.00', '72.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T022',
    slug: 'day-in-egyptian-museums',
    title: 'Day In Egyptian Museums',
    summary: null,
    description:
      'Three Pyramids guide will give you the chance to see the whole history of Egypt in one day full of the history and stories the Egyptian Museum of antiquities. It displays the largest and most precious items of the Egyptian art in the world. It exhibits a rare collection of over 250,000 genuine artifacts that date as far back as 5000 years, including an exclusive exhibit dedicated to the Tutankhamon – A collection of treasures, gold, and jewelry that were buried in his tomb for over 3,500 years before they were discovered in the 1920s when his tomb was excavated.(3 hrs. Time Spent) Then visiting The National Museum of Egyptian Civilization the Main Exhibition Hall show the four main crafts that shaped the Egyptian civilization: pottery, wood, Textile and ornaments You can see over there the oldest prosthetic toe all over the world, the skeleton of a man dates back to 30000',
    durationLabel: 'Approx.8hrs',
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from your hotel & return' },
      { kind: 'included', text: 'Private tour guide' },
      { kind: 'included', text: 'Entrance fees to all the mentioned sites' },
      { kind: 'included', text: 'All taxes & service charge' },
      { kind: 'included', text: 'Lunch meal at local resturant in cairo' },
    ],
    variants: soleVariant(partySizeTiers('156.00', '130.00', '110.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T023',
    slug: 'over-day-to-luxor-from-cairo-by-flight-or-train',
    title: 'Over Day to Luxor from Cairo by Flight or Train',
    summary: null,
    description:
      'Taking the flight towards Luxor. Upon arrival, you will be met, by our representative, having a blissful day tour kicking off at Karnak Temple, dedicated to the God Amon, his wife Mut and their son Khonsu, Valley of The Kings, containing the masterpieces of the ancient Egyptian tombs. Then move onto Temple of Queen Hatshpsute, Lunch is going to be served during your trip. In the evening, you will be driven to Luxor airport & back to Cairo. We promise that you will have a magnificent expesience and you will have a good care from the start to the end.if you would rather fill the time with additional activities your guide will be happy to make it happen for an extra cost.',
    // The brochure prints two duration lines for the two transport options.
    durationLabel: 'Approx. 12hrs. (by Flight) / Approx. 26hrs. (by Train)',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: true,
    itinerary: [],
    content: [
      { kind: 'included', text: 'Pick up services from the hotel and return.' },
      { kind: 'included', text: 'Entrance fees to the mentioned historical place.' },
      { kind: 'included', text: 'All transfers by a private vehicle.' },
      { kind: 'included', text: 'Private tour guide.' },
      { kind: 'included', text: 'Domestic flights Cairo - Luxor - Cairo or Train based on availability.' },
      { kind: 'included', text: 'Lunch at a good quality local restaurant.' },
      { kind: 'included', text: 'All Taxes & service charge' },
      { kind: 'note', text: 'The Prices May Changes Depende To The Flights And Timing' },
    ],
    variants: soleVariant(partySizeTiers('780.00', '683.00', '637.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T024',
    slug: 'grand-egyptian-museum-tour',
    title: 'Grand Egyptian Museum Tour',
    summary: null,
    description:
      "Three PyramidsTours Representative will pick you up to visit the Grand Egyptian Museum, Egypt's newest and most impressive cultural landmark. Located near the Great Pyramids of Giza, the museum is considered the largest archaeological museum in the world dedicated to one civilization. It offers a wonderful and inspiring experience, showcasing over 100,000 ancient artifacts that tell the story of Egypt's glorious history. Among its highlights is the complete Tutankhamun collection, displayed together for the first time, featuring his golden mask, jewelry, and treasures that once lay hidden in his tomb for thousands of years. The museum's stunning modern architecture and spacious galleries make it a truly unforgettable place to explore. After your visit,you will be transferred back to your hotel in comfort",
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    // The brochure prints no "Fees Include" block for this tour.
    content: [],
    variants: soleVariant(partySizeTiers('130.00', '104.00', '91.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'T025',
    slug: 'pyramids-and-grand-egyptian-museum-tour',
    title: 'Pyramids & Grand Egyptian Museum Tour',
    summary: null,
    description:
      "Three PyramidsTours Representative will pick you up from your hotel to start an unforgettable journey to the Giza Plateau, home of the world-famous Great Pyramids of Cheops, Chephren, and Mykerinus. You will marvel at these timeless wonders, standing tall for over 4,500 years, and capture beautiful photos near the majestic Sphinx, the guardian of the royal tombs with its lion's body and human head. Your tour continues with a visit to the Grand Egyptian Museum, Egypt's newest and most magnificent cultural attraction. Located just minutes from the pyramids, the museum houses more than 100,000 artifacts, offering an incredible insight into Egypt's ancient civilization. You will have the chance to admire the complete Tutankhamun collection, displayed together for the first time, along with many treasures never shown before. The museum's modern design and impressive displays make it a truly wonderful place to explore Egypt's glorious past After your tour, you will be transferred back to your hotel in comfort, carrying unforgettable memories of Egypt's history and heritage.",
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [],
    variants: soleVariant(partySizeTiers('195.00', '169.00', '152.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P01',
    slug: 'overnight-trip-to-st-catherin-monastery',
    title: 'Overnight Trip to St. Catherin Monastery',
    summary: null,
    // The page opens straight into Day 01; there is no separate lead paragraph.
    description: null,
    durationLabel: '2 days',
    scheduleLabel: 'Every Day Except Sat. & Thurs.',
    operatingDays: ['sunday', 'monday', 'tuesday', 'wednesday', 'friday'],
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 01',
        body: 'Three Pyramids Tour representative will pick you up from the hotel then drive to St, Catherine for about 6 hours. Check to your hotel to relax and overnight in your hotel.',
      },
      {
        dayNumber: 2,
        heading: 'Day 02',
        body: "At 02:00 am you will be picked up from your hotel and transferred to Moses Mountain and you will be accompanied by Bedouin Guide as an expert to Guide you to climb the sacred mountain, to experience the sunrise up the mountain. After you climb the mountain and go down at about 07 O'clock you will be guided to visit St, Catherine Monastery, which is considered one of the most famous monasteries in the world. The monastery was dedicated to one of Alexander's rulers, St Catherine, who was tortured to death for the sake of her new faith. After that, you will have your breakfast at the hotel & drive back to Cairo.",
      },
    ],
    content: [
      { kind: 'included', text: 'Transfer to Catherine & back' },
      { kind: 'included', text: 'Accommodation in Catherine for 01 night at a Hotel on half board basis' },
      { kind: 'included', text: 'Entrance fees to the mentioned historical places' },
      { kind: 'included', text: 'Private tour guide.' },
      { kind: 'included', text: 'Bedouin guide during climbing the mountain' },
      { kind: 'included', text: 'All taxes and service charges' },
      { kind: 'note', text: 'The Prices May Changes Depende To The Flights And Timing' },
    ],
    variants: soleVariant(partySizeTiers('858.00', '527.00', '455.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P02',
    slug: 'overnight-to-luxor-from-cairo-by-flight-or-train',
    title: 'Overnight to Luxor from Cairo by Flight or Train',
    summary: null,
    description: null,
    durationLabel: '2 days',
    scheduleLabel: 'Every Day',
    operatingDays: EVERY_DAY,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1: Cairo /Luxor Sightseeing Tours',
        body: 'Pyramids Valley Tours representative will pick you up from the hotel to Cairo Airport for your flight to Luxor, where you will be accompanied by your own private tour guide to visit the famous Karnak temple the largest place of worship ever built. Its ancient name Ipet-isut means "the most sacred of places." The temple, or, more correctly, the complex of temples, was built over more than two thousand years by generation after generation of pharaohs. Within the complex, the great "Hypostyle Hall" is an incredible forest of giant pillars. On the way you will enjoy lunch at quality restaurant and then you will be accompanied by your tour guide to visit the majestic Luxor temple which was built by Amenhotep III and Ramses II for ritual and festivals and dedicated to the god Amun with some free time for shopping in Luxor. From there will be driven to your hotel for check in, leisurely free time in Luxor and overnight stay in Luxor.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2: Luxor Sightseeing Tours/ Cairo',
        body: 'Early morning, enjoy a relaxing breakfast in your hotel in Luxor and then you will enjoy visiting the West Bank of The Nile River you will be visiting the two colossal statues of Amenhotep III (Colossi of Memnon), and then visit the Valley of the Kings, where the magnificent tombs discovered, those tombs were carved deep into the desert rock, richly decorated and filled with treasures for the Afterlife of the pharaohs, you will visit 3 tombs Continue the tour to visit the Hatshepsut temple at El Deir El Bahary, this impressive temple dedicated to the Queen Hatshepsut the only female pharaoh rises out of the desert plain in a series of terraces and merges with the sheer limestone cliffs that surround it. Proceed to have your lunch at local restaurant Then you will embark the Felucca to Banana Island on The Nile River, then you will be transferred to Luxor airport to fly back to Cairo where you will be met by our Pyramids Valley Representative to be transferred to your hotel in Cairo.',
      },
    ],
    content: [
      { kind: 'included', text: 'Pick up services from the hotel & return.' },
      { kind: 'included', text: 'Return flight from Cairo to Luxor or Train based on availability.' },
      { kind: 'included', text: 'Tour to Hatshepsut, Valley of the Kings.' },
      { kind: 'included', text: 'Tour to Karnak, Luxor Temples.' },
      { kind: 'included', text: 'Famous Bazaars in Luxor.' },
      { kind: 'included', text: 'Felucca boat to Banana Island' },
      { kind: 'included', text: 'Private tour guide.' },
      { kind: 'included', text: 'Entrance fees to the sights mentioned.' },
      { kind: 'included', text: 'Lunch at quality restaurant.' },
      { kind: 'included', text: 'Pick up service from hotel and return.' },
      { kind: 'included', text: 'Accommodation in Luxor at a hotel.' },
      { kind: 'included', text: 'All transfers' },
      { kind: 'included', text: 'All services charges and taxes included.' },
      { kind: 'note', text: 'Meals: Breakfast, Lunch' },
      { kind: 'note', text: 'Flight Times Approx.: Cairo to Luxor 06:00 / 07:00, Luxor to Cairo 22:00 / 23:00' },
      { kind: 'note', text: 'Prices May Changes Depende To The Flights And Timing' },
    ],
    variants: soleVariant(partySizeTiers('910.00', '780.00', '650.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    // The brochure titles P03, P04 and P05 identically ("2 Day Tour Package"),
    // so the tour code is carried in the slug purely to keep the three public
    // addresses distinct. Same for P07/P08 below.
    code: 'P03',
    slug: '2-day-tour-package-p03',
    title: '2 Day Tour Package',
    summary: null,
    description: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1 Giza Pyramids, Sphinx, And Sakkara Or Dahshur',
        body: "your private tour guide will pick you up from the hotel, to start your day tour visiting the Red Pyramid & Bent Pyramid at Dahshur, Dahshur is a famous royal necropolis in Egypt holds many famous Pyramids includes the red & bent Pyramids of king snefru. it's about 40km from Cairo. Move on to visit the Step Pyramid of Zoser, the world's oldest major stone structure. It was built in the 3rd Dynasty (around 2630 BC) for King Djoser. Lunch will be served at a local restaurant, before moving on to enjoy an excursion to The Pyramids of Cheops, Chephren and Mykerinus. Continue on to visit the Great Sphinx which dates back to the time of Chephren; the tour also includes a visit to the Valley Temple, which belongs to the Pyramids of Chephren. later you will be transferred Back to the hotel.",
      },
      {
        dayNumber: 2,
        heading: 'Day 2 Egyptian Museum, Civilization Musuem Or Old Bazaar',
        body: "The Egyptian Museum displays a rare collection of 5000 years of art which is considered the largest most precious collection of Egyptian art in the world. Over 250,000 overwhelming artifacts are presented, including an exhibit dedicated to Tutankhamen collection of treasure, gold and jewelry which was enclosed in his tomb for over 3,500 years before it was discovered in the 1920s when his tomb was excavated. Then proceed to visit Mohamed Ali Alabaster Mosque inside the Citadel of Salah El Din. Lunch will be served in a local restaurant. Continue driving to the area of Islamic Cairo, where you will be able to explore Khan El Khalili, Cairo's old bazaar. Then we move on to Coptic Cairo to visit the hanging Church, Ben Ezra Synagogue, Church of St. Barbara, Church of Abu Serga. later you will be transferred Back to the hotel.",
      },
      {
        dayNumber: null,
        heading: 'Sound & Light Show Dinner.',
        body: 'You will be invited for a dinner on the roof top terrace while you watch the sound & Light show.',
      },
    ],
    content: [
      { kind: 'note', text: PROGRAM_DAYS_CHANGEABLE_NOTE },
      { kind: 'note', text: 'you can change one of the museums to the GEM and pay extra.' },
    ],
    variants: soleVariant(partySizeTiers('312.00', '260.00', '234.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P04',
    slug: '2-day-tour-package-p04',
    title: '2 Day Tour Package',
    summary: null,
    description: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1 Giza Pyramids, Sphinx, And Sakkara Or Dahshur',
        body: "your private tour guide will pick you up from the hotel, to start your day tour visiting the Red Pyramid & Bent Pyramid at Dahshur, Dahshur is a famous royal necropolis in Egypt holds many famous Pyramids includes the red & bent Pyramids of king snefru. it's about 40km from Cairo. Move on to visit the Step Pyramid of Zoser, the world's oldest major stone structure. It was built in the 3rd Dynasty (around 2630 BC) for King Djoser. Lunch will be served at a local restaurant, before moving on to enjoy an excursion to The Pyramids of Cheops, Chephren and Mykerinus. Continue on to visit the Great Sphinx which dates back to the time of Chephren; the tour also includes a visit to the Valley Temple, which belongs to the Pyramids of Chephren. later you will be transferred Back to the hote",
      },
      {
        dayNumber: null,
        heading: 'Sound & Light Show Dinner',
        body: 'You will be invited for a dinner on the roof top terrace while you watch the sound & Light show.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2 Egyptian Museum Or Civilization Musuem, Old Cairo Or Old Bazaar',
        body: "The Egyptian Museum displays a rare collection of 5000 years of art which is considered the largest most precious collection of Egyptian art in the world. Over 250,000 overwhelming artifacts are presented, including an exhibit dedicated to Tutankhamen collection of treasure, gold and jewelry which was enclosed in his tomb for over 3,500 years before it was discovered in the 1920s when his tomb was excavated. Then proceed to visit Mohamed Ali Alabaster Mosque inside the Citadel of Salah El Din. Lunch will be served in a local restaurant. Continue driving to the area of Islamic Cairo, where you will be able to explore Khan El Khalili, Cairo's old bazaar. Then we move on to Coptic Cairo to visit the hanging Church, Ben Ezra Synagogue, Church of St. Barbara, Church of Abu Serga. later you will be transferred Back to the hotel.",
      },
      {
        dayNumber: null,
        heading: 'Cairo Nile Dinner Cruise & Show.',
        body: "It is a fabulous way to enjoy a night on the Nile while you are in Cairo. So, you are invited to dinner on Nile cruising restaurant for two hours sailing trip on the Nile with belly dancer, folklore show, Oriental music and dinner. All the time, you'll be delighted in our Chef's menu along with a selection of Egyptian favorites, made with the freshest ingredients, and prepared to make it a memorable dining experience, later you will be transferred Back to your hotel.",
      },
    ],
    content: [
      { kind: 'note', text: PROGRAM_DAYS_CHANGEABLE_NOTE },
      { kind: 'note', text: 'you can change one of the museums to the GEM and pay extra.' },
    ],
    variants: soleVariant(partySizeTiers('364.00', '299.00', '260.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P05',
    slug: '2-day-tour-package-p05',
    title: '2 Day Tour Package',
    summary: null,
    description: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1 Giza Pyramids & Sphinx',
        body: "Your tour guide will pick you up from the hotel, to visit the Pyramids of Cheops, Chephren and Mykerinus. Then proceed to visit the Great Sphinx, the head of a pharaoh with a lion's body, dates from the time of Chephren. The tour also includes a visit to the Valley Temple which belongs to the Pyramids of Chephren. This temple served definitely two functions: First, it was used for the purification of the mummy of the king before its burial. Second, it was used for making the Mummification process of the king, and later you will be transferred back to the hote",
      },
      {
        dayNumber: null,
        heading: 'Sound & Light Show Dinner.',
        body: 'You will be invited for a dinner on the roof top terrace while you watch the sound & Light show.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2 Memphis, Sakkara and Dahshur tour.',
        body: "The Step Pyramid of Zoser, the world's oldest major stone structure. It was built in the 3rd Dynasty for King Djoser. After that transfer to Memphis which was founded by King Menes, and was the capital of Egypt during the Old Kingdom, it was considered to be a center of rule and culture for over 3000 years the first capital of Egypt, and see the Statue of Ramses II and the alabaster Sphinx of Memphis, Then visiting the Red Pyramid and Bent Pyramid at Dahshur, Dahshur is a famous royal necropolis in Egypt holds many famous Pyramids includes the red and bent Pyramids of king snefru. The site is about 40 km from Cairo, later you will be transferred Back to the hotel.",
      },
      {
        dayNumber: null,
        heading: 'Cairo Nile Dinner Cruise & Show.',
        body: "It is a fabulous way to enjoy a night on the Nile while you are in Cairo. So, you are invited to dinner on Nile cruising restaurant for two hours sailing trip on the Nile with belly dancer, folklore show, Oriental music and dinner. All the time, you'll be delighted in our Chef's menu along with a selection of Egyptian favorites, made with the freshest ingredients, and prepared to make it a memorable dining experience, later you will be transferred Back to your hotel.",
      },
    ],
    content: [{ kind: 'note', text: PROGRAM_DAYS_CHANGEABLE_NOTE }],
    variants: soleVariant(partySizeTiers('312.00', '273.00', '247.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P06',
    slug: '3-days-tour-package',
    title: '3 Days Tour Package',
    summary: null,
    description: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1 Giza Pyramids, Sphinx, And Sakkara Or Dahshur',
        body: "your private tour guide will pick you up from the hotel, to start your day tour visiting the Red Pyramid & Bent Pyramid at Dahshur, Dahshur is a famous royal necropolis in Egypt holds many famous Pyramids includes the red & bent Pyramids of king snefru. it's about 40km from Cairo. Move on to visit the Step Pyramid of Zoser, the world's oldest major stone structure. It was built in the 3rd Dynasty (around 2630 BC) for King Djoser. Lunch will be served at a local restaurant, before moving on to enjoy an excursion to The Pyramids of Cheops, Chephren and Mykerinus. Continue on to visit the Great Sphinx which dates back to the time of Chephren; the tour also includes a visit to the Valley Temple, which belongs to the Pyramids of Chephren. later you will be transferred Back to the hotel.",
      },
      {
        dayNumber: 2,
        heading: 'Day 2 Egyptian Museum Or Civilization Musuem, Old Cairo Or Old Bazaar',
        body: "The Egyptian Museum displays a rare collection of 5000 years of art which is considered the largest most precious collection of Egyptian art in the world. Over 250,000 overwhelming artifacts are presented, including an exhibit dedicated to Tutankhamen collection of treasure, gold and jewelry which was enclosed in his tomb for over 3,500 years before it was discovered in the 1920s when his tomb was excavated. Then proceed to visit Mohamed Ali Alabaster Mosque inside the Citadel of Salah El Din. Lunch will be served in a local restaurant. Continue driving to the area of Islamic Cairo, where you will be able to explore Khan El Khalili, Cairo's old bazaar. Then we move on to Coptic Cairo to visit the hanging Church, Ben Ezra Synagogue, Church of St. Barbara, Church of Abu Serga. later you will be transferred Back to the hotel.",
      },
      {
        dayNumber: null,
        heading: 'Sound & Light Show Dinner.',
        body: 'You will be invited for a dinner on the roof top terrace while you watch the sound & Light show.',
      },
      {
        dayNumber: 3,
        heading: 'Day 3 Day tour to Alexandria.',
        body: "Pyramids Valley Tours representative will pick you up from the hotel, and then transfer to enjoy amazing day trip to Alexandria. First visit Pompay's Pillar. It was constructed in honor of the Emperor Diocletian at the end of the 4th century. Originally from the temple of the Serapis, it was once a magnificent structure rivaling the Soma and the Caesarean. Then you drive to visit the Catacombs which are the largest Roman Cemetery consisting of three levels cut in the rock. Lunch at local restaurant in Alexandria, and then we proceed to see the Qaitbay Citadel which was built on the site of the ancient pharaohs (lighthouse) of Alexandria then to Bibliotheca Alexandrina. later you will be transferred Back to your hotel.",
      },
    ],
    content: [
      { kind: 'note', text: PROGRAM_DAYS_CHANGEABLE_NOTE },
      { kind: 'note', text: 'you can change one of the museum with the GEM and pay extra.' },
    ],
    variants: soleVariant(partySizeTiers('488.00', '416.00', '351.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P07',
    slug: '4-days-tour-package-p07',
    title: '4 Days Tour Package',
    summary: null,
    description: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1 Giza Pyramids, Sphinx, And Egyptian Museum, Or Civilization Musuem.',
        body: 'Three Pyramids Tours representative will pick you up from the hotel, to enjoy an excursion to The Pyramids of Cheops, Chephren and Mykerinus. Then proceed to visit the Great Sphinx, which dates from the time of Chephren; the tour also includes a visit to the Valley Temple, which belongs to the pyramid of chefren. Then have your lunch at local restaurant and Move to visit the Egyptian Museum, which features artifacts from the Pharaonic period. The museum displays a rare collection of 5000 years of art. Over 250,000 genuine artifacts are presented, including an exhibit dedicated to Tutankhamen collection of treasure, gold and jewelry which was enclosed in his tomb for over 3,500 years before it was discovered in the 1920s when his tomb was discovered, later you will be transferred Back to your hotel.',
      },
      {
        dayNumber: null,
        heading: 'Sound & Light Show Dinner.',
        body: 'You will be invited for a dinner on the roof top terrace while you watch the sound & Light show.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2 Memphis and Sakkara Tour.',
        body: "The Step Pyramid of Zoser, the world's oldest major stone structure. It was built in the 3rd Dynasty for King Djoser. After that transfer to Memphis which was founded by King Menes, it was the capital of Egypt during the Old Kingdom, considered to be a center of rule and culture for over 3000 years the first capital of Egypt, and see the Statue of Ramses II and the alabaster Sphinx of Memphis, later you will be transferred Back to your hotel.",
      },
      {
        dayNumber: null,
        heading: 'Cairo Nile Dinner Cruise & Show.',
        body: "It is a fabulous way to enjoy a night on the Nile while you are in Cairo. So, you are invited to dinner on Nile cruising restaurant for two hours sailing trip on the Nile with belly dancer, folklore show, Oriental music and dinner. All the time, you'll be delighted in our Chef's menu along with a selection of Egyptian favourites, made with the freshest ingredients, and prepared to make it a memorable dining experience, later you will be transferred Back to your hotel.",
      },
      {
        dayNumber: 3,
        heading: 'Day 3 Day tour to Alexandria.',
        body: "Pyramids Valley Tours representative will pick you up from the hotel, and then transfer to enjoy amazing day trip to Alexandria. First visit Pompay's Pillar. It was constructed in honour of the Emperor Diocletian at the end of the 4th century. Originally from the temple of the Serapis, it was once a magnificent structure rivaling the Soma and the Caesarean. Then you drive to visit the Catacombs which are the largest Roman Cemetery consisting of three levels cut in the rock. Lunch at local restaurant in Alexandria, and then we proceed to see the Qaitbay Citadel which was built on the site of the ancient pharaohs (lighthouse) of Alexandria then to Bibliotheca Alexandrina, later you will be transferred Back to your hotel.",
      },
      {
        dayNumber: 4,
        heading: 'Day 4 Citadel, Old Cairo and Old bazaar.',
        body: "Our tours representative will pick u up from the hotel to visit Mohamed Ali Alabaster Mosque inside the Citadel of Salah El Din. Lunch will be served in a local restaurant. Continue driving to the area of Islamic Cairo, where you will be able to explore Khan El Khalili, Cairo's old bazaar. Then we move on to Coptic Cairo to visit the Hanging Church, Ben Ezra Synagogue, Church of St. Barbara, Church of Abu Serga. later you will be transferred Back to your hotel.",
      },
    ],
    content: [{ kind: 'note', text: 'you can change one of the museums with the GEM and pay extra.' }],
    variants: soleVariant(partySizeTiers('598.00', '520.00', '468.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P08',
    slug: '4-days-tour-package-p08',
    title: '4 Days Tour Package',
    summary: null,
    description: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1 Giza Pyramids, Sphinx, And Egyptian Museum, Or Civilization Musuem.',
        body: 'Three Pyramids Tours representative will pick you up from the hotel, to enjoy an excursion to The Pyramids of Cheops, Chephren and Mykerinus. Then proceed to visit the Great Sphinx, which dates from the time of Chephren; the tour also includes a visit to the Valley Temple, which belongs to the pyramid of chefren. Then have your lunch at local restaurant and Move to visit the Egyptian Museum, which features artifacts from the Pharaonic period. The museum displays a rare collection of 5000 years of art. Over 250,000 genuine artifacts are presented, including an exhibit dedicated to Tutankhamen collection of treasure, gold and jewelry which was enclosed in his tomb for over 3,500 years before it was discovered in the 1920s when his tomb was discovered, later you will be transferred Back to your hotel.',
      },
      {
        dayNumber: null,
        heading: 'Sound & Light Show Dinner.',
        body: 'You will be invited for a dinner on the roof top terrace while you watch the sound & Light show.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2 & 3 Over day Luxor from Cairo by Flight.',
        body: 'Pyramids Valley Tours representative will pick you up from the hotel to Cairo Airport for your flight to Luxor, where you will be accompanied by your own private tour guide to visit the famous Karnak temple the largest place of worship ever built. Its ancient name Ipet-isut means "the most sacred of places." The temple, or, more correctly, the complex of temples, was built over more than two thousand years by generation after generation of pharaohs. Within the complex, the great "Hypostyle Hall" is an incredible forest of giant pillars. On the way you will enjoy lunch at quality restaurant and then you will be accompanied by your tour guide to visit the majestic Luxor temple which was built by Amenhotep III and Ramses II for ritual and festivals and dedicated to the god Amun with some free time for shopping in Luxor. From there will be driven to your hotel for check in, leisurely free time in Luxor and overnight stay in Luxor. Early morning, enjoy a relaxing breakfast in your hotel in Luxor and then you will enjoy visiting the West Bank of The Nile River you will be visiting the two colossal statues of Amenhotep III (Colossi of Memnon), and then visit the Valley of the Kings, where the magnificent tombs discovered, those tombs were carved deep into the desert rock, richly decorated and filled with treasures for the Afterlife of the pharaohs, you will visit 3 tombs Continue the tour to visit the Hatshepsut temple at El Deir El Bahary, this impressive temple dedicated to the Queen Hatshepsut the only female pharaoh rises out of the desert plain in a series of terraces and merges with the sheer limestone cliffs that surround it. Proceed to have your lunch at local restaurant Then you will embark the Felucca to Banana Island on The Nile River, then you will be transferred to Luxor airport to fly back to Cairo where you will be met by our Pyramids Valley Representative to be transferred to your hotel in Cairo.',
      },
      {
        dayNumber: 4,
        heading: 'Day 4 Cairo Nile Dinner Cruise & Show.',
        body: "It is a fabulous way to enjoy a night on the Nile while you are in Cairo. So, you are invited to dinner on Nile cruising restaurant for two hours sailing trip on the Nile with belly dancer, folklore show, Oriental music and dinner. All the time, you'll be delighted in our Chef's menu along with a selection of Egyptian favourites, made with the freshest ingredients, and prepared to make it a memorable dining experience, later you will be transferred Back to your hotel.",
      },
    ],
    content: [
      { kind: 'note', text: PROGRAM_DAYS_CHANGEABLE_NOTE },
      { kind: 'note', text: 'you can change one of the museums with the GEM and pay extra.' },
      { kind: 'note', text: 'Price May Change Depending on The Flights And Timing.' },
    ],
    variants: soleVariant(partySizeTiers('1040.00', '910.00', '780.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P09',
    slug: 'cairo-day-tour-to-bahariya-oasis',
    title: 'Cairo - Day tour to Bahariya Oasis',
    summary: null,
    description:
      'Bahariya Oasis is the first real desert oasis in Egypt. It is located 365 Kilometer south-west of Cairo, which is about a 4.5 hour drive from Cairo. Bahariya has attracted many travelers over the years in search of peace, spirituality and desert freedom.',
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: null,
        heading: 'Itinerary',
        body: 'Your guide will pick you up from your hotel in Cairo. Upon arrival in Bahariya Oasis you will have lunch. After lunch there will be a visit to Agabat Mountain, Old & New White desert, followed by a visit to the Crystal Mountain and the Black Desert, form where you will be transferred back to your hotel in Cairo.',
      },
    ],
    content: [
      { kind: 'included', text: 'Private transfers Cairo - Bahareya - Cairo' },
      { kind: 'included', text: 'Driver, guides, assistants, provision of the 4x4' },
      { kind: 'included', text: 'All materials for the bivouac (thick mattress, covers, pillows, carpet, table)' },
      { kind: 'included', text: 'Full pension (cold breakfasts, lunches, hot dinners simmered on wood fire with fresh products)' },
      { kind: 'included', text: 'Drinks (teas, coffee, sodas, mineral water)' },
      { kind: 'excluded', text: ALCOHOL_EXCLUSION },
      // A vehicle/logistics note, not a package capacity limit: the 3+ tier
      // stays unbounded and larger parties are invited to contact the hotel.
      { kind: 'note', text: FOUR_BY_FOUR_CAPACITY_NOTE },
      { kind: 'note', text: 'Price May Change Depending To The Timing.' },
    ],
    variants: soleVariant(partySizeTiers('488.00', '423.00', '390.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P10',
    slug: '2-day-1-night-bahariya-oasis',
    title: '2 Day - 1 Night Bahariya Oasis',
    summary: null,
    description:
      'Bahariya Oasis is the first real desert oasis in Egypt. It is located 365 Kilometer south-west of Cairo, which is about a 4.5 hour drive from Cairo. Bahariya has attracted many travelers over the years in search of peace, spirituality and desert freedom.',
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1',
        body: 'Your guide will pick you up from your hotel in Cairo. Upon arrival in Bahariya Oasis you will have lunch. After lunch there will be a visit to Agabat Mountain, Old & New White desert. Overnight stay: The New White Desert Camp.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2',
        body: 'After breakfast you will visit the Crystal Mountain and the Black Desert, from where you will return to Bahariya Oasis ( Sahara Camp) to have lunch, before being transferred back to your hotel in Cairo.',
      },
    ],
    content: [
      { kind: 'included', text: 'Private transfers Cairo - Bahareya - Cairo' },
      { kind: 'included', text: 'Driver, guides, assistants, provision of the 4x4' },
      { kind: 'included', text: 'All materials for the bivouac (thick mattress, covers, pillows, carpet, table)' },
      { kind: 'included', text: 'Full pension (cold breakfasts, lunches, hot dinners simmered on wood fire with fresh products)' },
      { kind: 'included', text: 'Drinks (teas, coffee, sodas, mineral water)' },
      { kind: 'excluded', text: ALCOHOL_EXCLUSION },
      { kind: 'note', text: FOUR_BY_FOUR_CAPACITY_NOTE },
      { kind: 'note', text: 'Price May Change Depending To The Timing.' },
    ],
    variants: soleVariant(partySizeTiers('520.00', '488.00', '423.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P11',
    slug: '3-days-2-nights-bahariya-oasis-white-desert',
    title: '3 Days - 2 Nights: Bahariya Oasis, White Desert',
    summary: null,
    description: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1',
        body: 'Your guide will pick you up from your hotel in Cairo. Upon arrival you will have lunch and dinner in Bahariya Oasis. Overnight stay: Sahara Camp.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2',
        body: 'After breakfast you will visit the Black Desert, Crystal Mountain, Agabat, Flower Desert, Roman Springs, Tent Valley. Overnight stay: The White or Western Desert Camp.',
      },
      {
        dayNumber: 3,
        heading: 'Day 3',
        body: 'Breakfast and lunch in Bahariya, before before going back to Cairo',
      },
    ],
    content: [
      { kind: 'included', text: 'Private transfers Cairo - El-Fayoum - Cairo' },
      { kind: 'included', text: 'Driver, guides, assistants' },
      { kind: 'included', text: 'All materials for the bivouac (thick mattress, covers, pillows, carpet, table)' },
      { kind: 'included', text: 'Full pension (cold breakfasts, lunches, hot dinners simmered on wood fire)' },
      { kind: 'included', text: 'Drinks (teas, coffee, sodas, mineral water).' },
      { kind: 'excluded', text: ALCOHOL_EXCLUSION },
      { kind: 'note', text: FOUR_BY_FOUR_CAPACITY_NOTE },
      { kind: 'note', text: 'Price May Change Depending on The Timing.' },
    ],
    variants: soleVariant(partySizeTiers('618.00', '585.00', '579.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    code: 'P12',
    slug: '4-days-3-nights-bahariya-oasis-white-desert',
    title: '4 Days - 3 Nights: Bahariya Oasis, White Desert',
    summary: null,
    description: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1',
        body: 'Your guide will pick you up from your hotel in Cairo. Upon arrival you will have lunch and dinner in Bahariya Oasis. Overnight stay: Sahara Camp',
      },
      {
        dayNumber: 2,
        heading: 'Day 2',
        body: 'After breakfast you will visit the Black Desert, Crystal Mountain & Agabat. Overnight stay: Agabat Mountain Camp.',
      },
      {
        dayNumber: 3,
        heading: 'Day 3',
        body: 'After breakfast, you will visit the Flower Desert, Tent Valley, Akasiya Tree and Magic Roman Springs. There will be a lunch in Roman Springs, followed by a visit to the New White Desert to stay the night. Overnight stay: The New White Desert Camp.',
      },
      {
        dayNumber: 4,
        heading: 'Day 4',
        body: 'After breakfast you will visit the Mashroum Old White Desert. There will be lunch back in Bahariya Oasis, before going back to Cairo',
      },
    ],
    content: [
      { kind: 'included', text: 'Private transfers Cairo-Bahareya-Cairo' },
      { kind: 'included', text: 'Driver, guides, assistants' },
      { kind: 'included', text: 'All materials for the bivouac (thick mattress, covers, pillows, carpet, table)' },
      { kind: 'included', text: 'Full pension (cold breakfasts, lunches, hot dinners simmered on wood fire)' },
      { kind: 'included', text: 'Drinks (teas, coffee, sodas, mineral water).' },
      { kind: 'excluded', text: ALCOHOL_EXCLUSION },
      { kind: 'note', text: FOUR_BY_FOUR_CAPACITY_NOTE },
      { kind: 'note', text: 'Price May Change Depending To The Timing.' },
    ],
    variants: soleVariant(partySizeTiers('780.00', '715.00', '683.00'), CHILD_6_TO_12_HALF_PRICE),
  },
  {
    // No child column on this page, so all three child fields stay null.
    code: 'P13',
    slug: '7-days-6-night-el-fayoum-and-white-desert',
    title: '7 Days - 6 Night: El Fayoum and White Desert',
    summary: null,
    description:
      'Bahariya Oasis is the first real desert oasis in Egypt. It is located 365 Kilometer south-west of Cairo, which is about a 4.5 hour drive from Cairo. Bahariya has attracted many travelers over the years in search of peace, spirituality and desert freedom. Wadi Al-Hitan "Valley of the Whales" is a paleontological site in El Fayoum, about 150 km southwest of Cairo. It was designated a UNESCO World Heritage site in July 2005 for its hundreds of fossils of some of the earliest forms of whales. The site reveals evidence for the explanation of one of the greatest mysteries of the evolution of whales: the emergence of the whale as an ocean-going mammal from a previous life as a land-based animal. No other place in the world yields the number, concentration and quality of such fossils, as is their accessibility and setting in an attractive and protected landscape.This is why it was added by the UNESCO to the list of protected World Heritage sites.',
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1',
        body: 'At 07:00 am your guide will pick you up from your hotel in Cairo and drive to El Fayoum to enjoy Fayoum waterfalls, Salt Lake, Al-Qaser, Elsagha, and finally Mudawara Mountain. Overnight stay: Elghroud Camp.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2',
        body: 'After breakfast you will visit Wadi Al-Hitan, then move on to Bahariya Oasis where you will enjoy your lunch and a local tour in Bahariya. Overnight stay: Sahara Camp.',
      },
      {
        dayNumber: 3,
        heading: 'Day 3',
        body: 'After breakfast you will visit the Black Desert and Bedouin Village where you will have lunch. After lunch you will visit the Crystal Mountain, Agabat, and Flower stone. *Optional ( Sand Board- free of charge) Overnight stay: Agabat Desert Camp.',
      },
      {
        dayNumber: 4,
        heading: 'Day 4',
        body: 'After breakfast there is a visit to Agabat Valley, Magic Spring Valley where you will have lunch. After lunch you will continue to the new white desert, where you will have dinner. Overnight stay: New White Desert Camp.',
      },
      {
        dayNumber: 5,
        heading: 'Day 5',
        body: 'After breakfast you will drive to the Old white desert, Tent Valley, followed by a visit to Farafra (including a visit to the art Museum in Farafra), before moving to El Dakhla to visit Dier Elhagar. Overnight stay: Bedouin Camp.',
      },
      {
        dayNumber: 6,
        heading: 'Day 6',
        body: 'After breakfast you will visit Mout Village, Bashandi, and Balat. The tour will continue via Elkharga road, to visit Elghoroud Elhelaliya, Elbagawat and Hibis Temple. Overnight stay: Elkharga Camp.',
      },
      {
        dayNumber: 7,
        heading: 'Day 7',
        body: 'After breakfast you will be transferred back to your hotel in Cairo.',
      },
    ],
    content: [
      { kind: 'note', text: FOUR_BY_FOUR_CAPACITY_NOTE },
      { kind: 'note', text: 'Price May Change Depending on The Timing.' },
    ],
    variants: soleVariant(partySizeTiers('2275.00', '2210.00', '2080.00'), NO_CHILD_RULE),
  },
  {
    code: 'P14',
    slug: '5-days-4-nights-siwa',
    title: '5 Days -  4 Nights Siwa',
    summary: null,
    description: null,
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1',
        body: 'Your guide will pick you up from your hotel in Cairo to visit Siwa, which is about a 12-hour drive from Cairo. You will have lunch in a local restaurant along the route. After arrival, you will check in at your hotel in Siwa ( Siwa Shali or Siwa Paradise).',
      },
      {
        dayNumber: 2,
        heading: 'Day 2',
        body: 'After breakfast, there is a visit to Gabal El Maouta, the Great Alexander, Amun Temple, and Cleopatra Roman water spring, followed by a visit to Eldakrour Mountain and Bier abu Shoroof water spring, where you will have lunch. After lunch you will continue to Shali caves, where you can enjoy the beautiful Siwa desert scenery from an open air terrace. From there you will move to visit Fatnas for a sunset photo session. After sunset you will return to your hotel in Siwa for dinner. Overnight stay: Hotel in Siwa',
      },
      {
        dayNumber: 3,
        heading: 'Day 3',
        body: 'Breakfast at the hotel and some free time. Departure at 02:00 pm to visit the Grand Sand Sea, and the Hot & Cold water springs. Overnight stay: Desert Camp.',
      },
      {
        dayNumber: 4,
        heading: 'Day 4',
        body: 'After breakfast you will return to your hotel in Siwa and enjoy free time for the rest of the day.',
      },
      {
        dayNumber: 5,
        heading: 'Day 5',
        body: 'After breakfast you will be transferred back to your hotel in Cairo.',
      },
    ],
    content: [
      { kind: 'note', text: FOUR_BY_FOUR_CAPACITY_NOTE },
      { kind: 'note', text: 'Price May Change Depending on The Timing.' },
    ],
    variants: soleVariant(partySizeTiers('2470.00', '2340.00', '2145.00'), NO_CHILD_RULE),
  },
  {
    code: 'P15',
    slug: 'day-use-in-5-stars-hotel',
    title: 'Day use in 5 Stars Hotel',
    summary: null,
    description:
      'Our guide will pick you up from Three Pyramids Boutique Hotel and take you to a 5-star hotel, to spend an entire day relaxing by the swimming pool, including lunch & soft drinks. At the end of the day you will be picked up to return to Pyramids Valley Boutique Hotel.',
    durationLabel: null,
    scheduleLabel: null,
    operatingDays: null,
    requiresPriceConfirmation: false,
    itinerary: [],
    content: [],
    variants: soleVariant(partySizeTiers('156.00', '152.00', '117.00'), NO_CHILD_RULE),
  },
  {
    // Cabin types, not party-size tiers: each cabin has one per-person price
    // that does not vary with the size of the party. The brochure names no
    // preferred cabin, so neither variant is marked default.
    code: 'P16',
    slug: 'aswan-luxor-nile-cruise-4-days-3-nights',
    title: 'Aswan–Luxor–Nile Cruise, 4 Days - 3 Nights',
    summary: null,
    description:
      'Fly from Cairo to Aswan for a 4-day cruise tour on the Nile. Visit Karnak, Luxor Temple, the Valley of the Kings,Hatshepsut Temple, Kom Ombo, Edfu, Philae Temple, and enjoy the beautiful scenery of the Nile Valley',
    durationLabel: null,
    // Preserved verbatim, but not converted into bookable weekdays: the range
    // may describe the cruise's own sailing window rather than the departure
    // days a guest may pick.
    scheduleLabel: 'Every Wednesday – Friday',
    operatingDays: null,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1: Fly Cairo to Aswan - Nile Cruise Tour',
        body: 'Pick you up from your hotel in Cairo. Transfer to Cairo international airport to fly to Aswan. Transfer to embark Nile Cruise before lunch. Visit the High Dam, Unfinished Obelisk & Philae Temple. Lunch on board. Dinner on board. Overnight in Aswan.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2: Kom-Ombo and Edfu Temples',
        body: 'Morning Sail to Kom-Ombo. Breakfast on board. Visit Kom-Ombo. Then sail to Edfu. Lunch on board. After that visit Edfu Temple. Sail to Luxor late arrival. Dinner on board.',
      },
      {
        dayNumber: 3,
        heading: 'Day 3: Luxor Nile Cruise Tour',
        body: 'Breakfast on board. Visit West bank (Valley of the Kings, the Temple of Queen Hatshepsut and the Colossi of Memnon). Lunch on board. Dinner on board. Overnight in Luxor.',
      },
      {
        dayNumber: 4,
        heading: 'Day 4: Luxor Nile Cruise - Fly Back to Cairo',
        body: 'Breakfast on board. Visit East Bank ( Karnak & Luxor Temples). Disembarkation after breakfast. Then transfer back from Luxor airport to fly back to Cairo. Assistance by our representative at Cairo Airport and transfer back to your hotel',
      },
    ],
    content: [
      { kind: 'included', text: 'Meet and assist service upon arrival & departure' },
      { kind: 'included', text: 'Assistance of our personnel during your stay and excursions' },
      { kind: 'included', text: 'All transfers' },
      { kind: 'included', text: 'Flight tickets or train tickets from Cairo to Aswan and Luxor to Cairo' },
      { kind: 'included', text: 'Accommodation for 3 nights on board 5-star cruise on full board basis' },
      { kind: 'included', text: 'All Nile Cruise excursions as mentioned in the itinerary' },
      { kind: 'included', text: 'Entrance fees to all sights between Luxor and Aswan' },
      { kind: 'included', text: 'Egyptologist guide during your excursions' },
      { kind: 'included', text: 'All service charges and taxes' },
      { kind: 'note', text: 'Cruise Schedule may vary slightly depending on the exact Boat and seasonal change.' },
      { kind: 'note', text: 'Prices can be vary in the season' },
      { kind: 'note', text: 'Price May Change Depending To The Flights And Timing.' },
    ],
    variants: [
      {
        key: 'single-cabin',
        label: 'Single Cabin',
        isDefault: false,
        ...NO_CHILD_RULE,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '1638.00' }],
      },
      {
        key: 'double-cabin',
        label: 'Double Cabin',
        isDefault: false,
        ...NO_CHILD_RULE,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '1313.00' }],
      },
    ],
  },
  {
    code: 'P17',
    slug: 'luxor-aswan-nile-cruise-5-days-4-nights',
    title: 'Luxor-Aswan –Nile Cruise, 5 Days-4 Nights',
    summary: null,
    description:
      'Fly from Cairo to Luxor for a 5-day cruise tour on the Nile. Visit Karnak, Luxor Temple, the Valley of the Kings,Hatshepsut Temple, Kom Ombo, Edfu, Philae Temple, and enjoy the beautiful scenery of the Nile Valley',
    durationLabel: null,
    scheduleLabel: 'Every Monday - Saturday',
    operatingDays: null,
    requiresPriceConfirmation: true,
    itinerary: [
      {
        dayNumber: 1,
        heading: 'Day 1:Arrive to Aswan - Nile Cruise Tour',
        body: 'Pick you up from your hotel in Cairo. Transfer to Cairo international airport or the train station to Aswan. Transfer to embark Nile Cruise before lunch. Visit the East Bank, Karnak Temple and Luxor Temple. Lunch on board. Dinner on board. Overnight in Luxor.',
      },
      {
        dayNumber: 2,
        heading: 'Day 2:Kom-Ombo and Edfu Temples',
        body: 'Morning Sail to Kom-Ombo. Breakfast on board. Visit West Bank, Valley of Kings, Hatshepsut Temple, & finally the Colossi of Memnon. Lunch on board. After that start sailing to Edfu. Dinner on board. Overnight - Edfu',
      },
      {
        dayNumber: 3,
        heading: 'Day 3: Luxor Nile Cruise Tour',
        body: 'Breakfast on board. Visit of Edfu, Temple of Horus the best-preserved ancient Temple in Egypt, then return to your cruise. Lunch on board. Then start sailing to Kom-Ombo. Dinner on board. Overnight in Aswan',
      },
      {
        dayNumber: 4,
        heading: 'Day 4: Luxor Nile Cruise - Back to Cairo',
        body: 'Breakfast on board. Disembarkation after breakfast, Free morning or an optional tour to visit the great Temple of Abu Simbel then return to your Nile cruise enjoy your lunch on board.',
      },
      {
        dayNumber: 5,
        heading: 'Day 5: Nile Cruise – Check out',
        body: "Breakfast will be served on board. Trip will start with a visit of The High Dam, Philae Temple dedicated to one of ancient Egypt's important figures, The Goddess Isis). Then transfer from Aswan back to Cairo. Assistance by our representative at Cairo airport or train station & transfer back to hotel",
      },
    ],
    content: [
      { kind: 'included', text: 'Meet and assist service upon arrival & departure' },
      { kind: 'included', text: 'Assistance of our personnel during your stay and excursions' },
      { kind: 'included', text: 'All transfers' },
      { kind: 'included', text: 'Flight tickets or train tickets from Cairo to Luxor and Aswan to Cairo' },
      { kind: 'included', text: 'Accommodation for 4 nights on board 5-star cruise on full board basis' },
      { kind: 'included', text: 'All Nile Cruise excursions as mentioned in the itinerary' },
      { kind: 'included', text: 'Entrance fees to all sights between Luxor and Aswan' },
      { kind: 'included', text: 'Egyptologist guide during your excursions' },
      { kind: 'included', text: 'All service charges and taxes' },
      { kind: 'excluded', text: 'Tipping, Any personal expenses such as drinks, laundry.' },
      { kind: 'excluded', text: 'Any optional trips or unmentioned item.' },
      { kind: 'note', text: 'Cruise Schedule may vary slightly depending on the exact Boat and seasonal change.' },
      { kind: 'note', text: 'Price May Change Depending on The Flights And Timing.' },
    ],
    variants: [
      {
        key: 'single-cabin',
        label: 'Single Cabin',
        isDefault: false,
        ...NO_CHILD_RULE,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '1898.00' }],
      },
      {
        key: 'double-cabin',
        label: 'Double Cabin',
        isDefault: false,
        ...NO_CHILD_RULE,
        rates: [{ minPartySize: 1, maxPartySize: null, adultUnitRate: '1651.00' }],
      },
    ],
  },
];
