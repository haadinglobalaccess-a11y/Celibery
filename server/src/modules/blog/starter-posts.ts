/**
 * Starter buying guides, added as DRAFTS from Admin → Website content → Blog ("Add starter guides").
 * General, verifiable technical guidance only — no product claims. The store team reviews (and the
 * Arabic is checked by a native speaker) before publishing. Sub-headings are the questions people ask
 * search engines and AI assistants, each answered directly in the first sentence (AEO/GEO).
 */
export const STARTER_POSTS = [
  {
    slug: 'how-to-choose-a-power-bank',
    tags: ['power-banks', 'buying-guide', 'travel'],
    categories: ['power-banks'],
    title: { en: 'How to choose the right power bank: capacity, watts and travel rules', ar: 'كيف تختار الباور بانك المناسب: السعة والواط وقواعد السفر' },
    excerpt: {
      en: 'Choose a power bank by three numbers: capacity (mAh) for how many charges you need, output (W) for how fast it charges, and watt-hours (Wh) if you will fly with it.',
      ar: 'اختر الباور بانك بثلاثة أرقام: السعة (مللي أمبير) لعدد مرات الشحن، والقدرة (واط) لسرعة الشحن، والواط ساعة إذا كنت ستسافر بالطائرة.',
    },
    body: {
      en: `A power bank is the easiest way to keep your phone, earbuds and tablet charged away from a socket — on the road, at work or during Umrah. Three numbers decide which one is right for you.

### How many mAh do I need?
Capacity is measured in milliamp-hours (mAh). Part of the energy is lost in conversion, so a power bank delivers roughly 60–70% of its rated capacity to your phone.
- **10,000 mAh**: about 1.5–2 full phone charges. Light and pocket-sized for daily use.
- **20,000 mAh**: about 3–4 phone charges. A good choice for a long day out or a weekend trip.
- **30,000 mAh and more**: several devices over several days, or a tablet and a phone. Heavier, best for travel and camping.

### How many watts should a power bank have?
Output in watts (W) decides charging speed. Most phones fast-charge at 20–30 W over USB-C Power Delivery (PD); tablets and small laptops need 45–65 W or more. A power bank with a higher-watt USB-C port can still charge a phone safely: the device only draws what it supports.

### What do PD and QC mean?
**PD (USB Power Delivery)** is the fast-charging standard over USB-C used by iPhone, Samsung, Google and most laptops. **QC (Quick Charge)** is a fast-charging standard used mostly on USB-A ports and many Android phones. A power bank with both covers almost every device.

### Can I take a power bank on a plane?
Yes, in your carry-on bag only — never in checked luggage. Airlines follow IATA rules based on watt-hours (Wh): up to 100 Wh is allowed, 100–160 Wh needs the airline's approval, and above 160 Wh is not allowed. To estimate Wh, multiply mAh by 3.7 and divide by 1,000: a 20,000 mAh power bank is about 74 Wh. Always check your airline's rules before you fly.

### Built-in cables or separate cables?
Built-in cables mean nothing to forget — useful for travel. A power bank with ports gives you freedom to use your own cables. Many models offer both.

### Tips for a longer-lasting power bank
- Recharge it before it is completely empty, and store it partly charged.
- Keep it out of direct sun and hot cars, especially in the Saudi summer.
- Use a good cable and charger to recharge it.`,
      ar: `الباور بانك أسهل طريقة لإبقاء جوالك وسماعاتك وجهازك اللوحي مشحونة بعيداً عن مقبس الكهرباء — في الطريق أو في العمل أو أثناء العمرة. ثلاثة أرقام تحدد الخيار المناسب لك.

### كم مللي أمبير أحتاج؟
تُقاس السعة بالمللي أمبير ساعة (mAh). يضيع جزء من الطاقة أثناء التحويل، لذلك يوصل الباور بانك تقريباً 60–70% من سعته المكتوبة إلى جوالك.
- **10,000 مللي أمبير**: تقريباً شحنة إلى شحنتين كاملتين للجوال. خفيف ومناسب للجيب والاستخدام اليومي.
- **20,000 مللي أمبير**: تقريباً 3–4 شحنات للجوال. خيار جيد ليوم طويل أو رحلة نهاية الأسبوع.
- **30,000 مللي أمبير وأكثر**: لعدة أجهزة لعدة أيام، أو لجهاز لوحي مع جوال. أثقل وزناً ومناسب للسفر والرحلات البرية.

### كم واط يجب أن يكون الباور بانك؟
القدرة بالواط تحدد سرعة الشحن. معظم الجوالات تشحن بسرعة بقدرة 20–30 واط عبر USB-C Power Delivery (PD)، بينما تحتاج الأجهزة اللوحية واللابتوبات الصغيرة إلى 45–65 واط أو أكثر. منفذ USB-C بقدرة أعلى يشحن الجوال بأمان: الجهاز يسحب فقط ما يدعمه.

### ماذا تعني PD وQC؟
**PD (USB Power Delivery)** معيار الشحن السريع عبر USB-C الذي تستخدمه أجهزة آيفون وسامسونج وجوجل ومعظم اللابتوبات. **QC (Quick Charge)** معيار شحن سريع يُستخدم غالباً عبر منافذ USB-A وفي كثير من جوالات أندرويد. الباور بانك الذي يدعم الاثنين يناسب معظم الأجهزة.

### هل يمكنني أخذ الباور بانك في الطائرة؟
نعم، في حقيبة اليد فقط — وليس في الأمتعة المشحونة. تتبع شركات الطيران قواعد IATA المبنية على الواط ساعة (Wh): حتى 100 واط ساعة مسموح، ومن 100 إلى 160 واط ساعة يحتاج موافقة شركة الطيران، وما فوق 160 واط ساعة غير مسموح. لحساب الواط ساعة تقريباً اضرب المللي أمبير في 3.7 ثم اقسم على 1000: باور بانك 20,000 مللي أمبير يساوي تقريباً 74 واط ساعة. تأكد دائماً من قواعد شركة الطيران قبل السفر.

### كابلات مدمجة أم كابلات منفصلة؟
الكابلات المدمجة تعني أنك لن تنسى الكابل — مفيدة للسفر. أما المنافذ فتمنحك حرية استخدام كابلاتك. كثير من الموديلات تجمع الاثنين.

### نصائح لإطالة عمر الباور بانك
- اشحنه قبل أن يفرغ تماماً، وخزّنه وهو مشحون جزئياً.
- أبعده عن أشعة الشمس المباشرة والسيارات الحارة، خاصة في صيف السعودية.
- استخدم كابلاً وشاحناً جيدين لإعادة شحنه.`,
    },
  },
  {
    slug: 'what-is-a-gan-charger',
    tags: ['chargers', 'gan', 'buying-guide'],
    categories: ['charging-adapters'],
    title: { en: 'What is a GaN charger, and how many watts do you need?', ar: 'ما هو شاحن GaN؟ وكم واط تحتاج؟' },
    excerpt: {
      en: 'A GaN charger uses gallium nitride instead of silicon, so it is smaller and runs cooler at the same power — ideal for charging a phone and a laptop from one plug.',
      ar: 'شاحن GaN يستخدم نيتريد الغاليوم بدلاً من السيليكون، لذلك يكون أصغر وأقل حرارة بنفس القدرة — مثالي لشحن الجوال واللابتوب من مقبس واحد.',
    },
    body: {
      en: `If your laptop charger is big and heavy, a GaN charger is the upgrade you will notice every day.

### What does GaN mean?
GaN stands for gallium nitride, a semiconductor material that handles power more efficiently than the silicon used in older chargers. The result is a charger that is **smaller, lighter and cooler** for the same wattage.

### How many watts do I need?
Add up the devices you want to charge at the same time:
- **Phone**: 20–30 W for fast charging.
- **Tablet**: 30–45 W.
- **Laptop**: 45–100 W, depending on the model (check the watts printed on your original charger).
A 65 W multi-port GaN charger covers a laptop and a phone together; for several laptops or a full desk setup, look at 100–140 W charging stations.

### Is a higher-watt charger safe for my phone?
Yes. With USB-C Power Delivery, the charger and the phone agree on the power first, and the phone only takes what it supports. A 65 W charger charges a phone at the phone's own fast-charging speed.

### What happens when I use several ports at once?
The total power is shared between the ports. A charger labelled "65 W" can give 65 W to one device, but splits it when two or three devices are connected. The label or manual shows how the power is shared.

### USB-C or USB-A ports?
USB-C ports support Power Delivery and the highest speeds. USB-A ports are useful for older cables and accessories. A charger with both lets you keep using the cables you already have.

### Which plug is used in Saudi Arabia?
Saudi Arabia uses the three-pin UK-style plug (type G) for most new installations. Choose a charger with that plug, or with interchangeable plug heads if you travel.`,
      ar: `إذا كان شاحن اللابتوب لديك كبيراً وثقيلاً، فشاحن GaN هو الترقية التي ستلاحظها كل يوم.

### ماذا تعني GaN؟
GaN اختصار لنيتريد الغاليوم، وهي مادة أشباه موصلات تتعامل مع الطاقة بكفاءة أعلى من السيليكون المستخدم في الشواحن القديمة. والنتيجة شاحن **أصغر وأخف وأقل حرارة** بنفس عدد الواط.

### كم واط أحتاج؟
اجمع قدرة الأجهزة التي تريد شحنها في نفس الوقت:
- **الجوال**: 20–30 واط للشحن السريع.
- **الجهاز اللوحي**: 30–45 واط.
- **اللابتوب**: 45–100 واط حسب الموديل (راجع الواط المكتوب على شاحنه الأصلي).
شاحن GaN بقدرة 65 واط ومتعدد المنافذ يكفي للابتوب وجوال معاً، ولعدة لابتوبات أو مكتب كامل اختر محطات شحن بقدرة 100–140 واط.

### هل الشاحن ذو الواط الأعلى آمن على جوالي؟
نعم. مع USB-C Power Delivery يتفق الشاحن والجوال على القدرة أولاً، ويأخذ الجوال فقط ما يدعمه. الشاحن بقدرة 65 واط يشحن الجوال بسرعة الشحن السريع الخاصة بالجوال نفسه.

### ماذا يحدث عند استخدام عدة منافذ معاً؟
تتوزع القدرة الإجمالية بين المنافذ. الشاحن المكتوب عليه "65 واط" يعطي 65 واط لجهاز واحد، لكنه يوزعها عند توصيل جهازين أو ثلاثة. يوضح الملصق أو الدليل طريقة توزيع القدرة.

### منافذ USB-C أم USB-A؟
منافذ USB-C تدعم Power Delivery وأعلى سرعات الشحن. ومنافذ USB-A مفيدة للكابلات والإكسسوارات الأقدم. الشاحن الذي يجمع الاثنين يتيح لك الاستمرار في استخدام كابلاتك الحالية.

### ما نوع القابس المستخدم في السعودية؟
تستخدم السعودية القابس الثلاثي بالطراز البريطاني (النوع G) في معظم التمديدات الجديدة. اختر شاحناً بهذا القابس، أو برؤوس قابس قابلة للتبديل إذا كنت تسافر.`,
    },
  },
  {
    slug: 'usb-c-vs-lightning-cable-guide',
    tags: ['cables', 'usb-c', 'buying-guide'],
    categories: ['cables'],
    title: { en: 'USB-C, Lightning or Micro-USB: which charging cable do you need?', ar: 'USB-C أم Lightning أم Micro-USB: أي كابل شحن تحتاج؟' },
    excerpt: {
      en: 'Match the cable to the port on your device and on your charger: USB-C for most new phones (including iPhone 15 and later) and laptops, Lightning for older iPhones, Micro-USB for older accessories.',
      ar: 'اختر الكابل حسب منفذ جهازك ومنفذ الشاحن: USB-C لمعظم الجوالات الحديثة (ومنها آيفون 15 وما بعده) واللابتوبات، وLightning لأجهزة آيفون الأقدم، وMicro-USB للإكسسوارات القديمة.',
    },
    body: {
      en: `The right cable makes the difference between slow charging and full fast-charging speed. Look at both ends.

### Which cable does my phone use?
- **USB-C**: most Android phones, iPhone 15 and later, iPads with USB-C, and most laptops.
- **Lightning**: iPhone 14 and earlier, and older iPads and AirPods cases.
- **Micro-USB**: older Android phones, speakers, power banks and accessories.

### Which end goes into the charger?
Check your charger's port. New chargers usually have **USB-C** ports, so you need a **USB-C to USB-C** or **USB-C to Lightning** cable. Older chargers and car chargers often have **USB-A** ports, so you need a USB-A cable.

### Does the cable affect charging speed?
Yes. Fast charging needs a cable rated for the power: a 60 W USB-C cable is enough for phones, tablets and most laptops; laptops above 60 W need a 100 W (or 240 W) cable with an e-marker chip. For an iPhone, a USB-C to Lightning cable with a 20 W or higher USB-C charger enables fast charging.

### Is a braided cable better?
A braided outer layer protects the cable from bending and wear, so it usually lasts longer — useful for cables you carry every day or use in the car.

### Which length should I choose?
- **0.3 m**: power banks and car use, no tangles.
- **1 m**: everyday charging at a desk or socket.
- **1.5–2 m**: bedside and sofa, where sockets are far away.

### Do cables transfer data too?
Most charging cables also transfer data (photos, files), but speeds differ. If you move large files often, check the data speed in the product details.`,
      ar: `الكابل المناسب هو الفرق بين شحن بطيء وسرعة الشحن السريع الكاملة. انظر إلى طرفي الكابل.

### أي كابل يستخدم جوالي؟
- **USB-C**: معظم جوالات أندرويد، وآيفون 15 وما بعده، وأجهزة آيباد بمنفذ USB-C، ومعظم اللابتوبات.
- **Lightning**: آيفون 14 وما قبله، وأجهزة آيباد وعلب سماعات AirPods الأقدم.
- **Micro-USB**: جوالات أندرويد القديمة، والسماعات، وبعض الباور بانك والإكسسوارات.

### أي طرف يدخل في الشاحن؟
انظر إلى منفذ الشاحن. الشواحن الحديثة غالباً بمنافذ **USB-C**، لذلك تحتاج كابل **USB-C إلى USB-C** أو **USB-C إلى Lightning**. أما الشواحن القديمة وشواحن السيارة فكثيراً ما تكون بمنافذ **USB-A**، فتحتاج كابلاً بطرف USB-A.

### هل يؤثر الكابل على سرعة الشحن؟
نعم. الشحن السريع يحتاج كابلاً يدعم القدرة المطلوبة: كابل USB-C بقدرة 60 واط يكفي للجوالات والأجهزة اللوحية ومعظم اللابتوبات، أما اللابتوبات فوق 60 واط فتحتاج كابلاً بقدرة 100 واط (أو 240 واط) مزوداً بشريحة e-marker. ولأجهزة آيفون، كابل USB-C إلى Lightning مع شاحن USB-C بقدرة 20 واط أو أكثر يتيح الشحن السريع.

### هل الكابل المضفّر أفضل؟
الغلاف المضفّر يحمي الكابل من الانثناء والتآكل، لذلك يدوم عادة لفترة أطول — مفيد للكابلات التي تحملها يومياً أو تستخدمها في السيارة.

### أي طول أختار؟
- **0.3 متر**: للباور بانك والسيارة، بدون تشابك.
- **1 متر**: للشحن اليومي على المكتب أو بجانب المقبس.
- **1.5–2 متر**: بجانب السرير أو الكنبة حيث يكون المقبس بعيداً.

### هل تنقل الكابلات البيانات أيضاً؟
معظم كابلات الشحن تنقل البيانات أيضاً (الصور والملفات)، لكن السرعات تختلف. إذا كنت تنقل ملفات كبيرة باستمرار، راجع سرعة نقل البيانات في تفاصيل المنتج.`,
    },
  },
];
