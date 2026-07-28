---
title: "How big is the political polarization in the US? How predictable are voters?"
slug: "2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters"
date: 2020-11-15
description: "Red & blue US political maps create increased perceptions of polarization and more political stereotyping, compared to more accurate purple maps. 🔗 Source : Seeing Red (and Blue): Effects of Electoral College Depictions on Political Group Perception Most…"
author: "Victoriano Izquierdo"
locale: en
draft: false
format: markdown
categories: [data]
sourceUrl: "https://app.notion.com/p/153056c9495e479ca94ce4990010213f"
cover: "blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-01.jpg"
coverInBody: true
---

> Red & blue US political maps create increased perceptions of polarization and more political stereotyping, compared to more accurate purple maps.

🔗 **Source**: [Seeing Red (and Blue): Effects of Electoral College Depictions on Political Group Perception](https://sci-hub.se/https://spssi.onlinelibrary.wiley.com/doi/abs/10.1111/j.1530-2415.2009.01183.x)

**Most maps** presented by the media to show the results of the elections looks like this one from The New York Times:

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-01.jpg "text-width")

And it **makes sense**. All the votes from one state will go for one party even if the difference is only one vote; that’s how the electoral system works in America. The **winner takes all**. But according to these academics, this leads to many people think that voters from Texas are entirely different from New Yorkers, while if you check the numbers, you’ll see **the difference is relatively small**, less than 10 points in both states for both parties.

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-02.jpg "text-width")

So they encourage these **purple maps** that mix blue and red so that people only see few significant differences in states like California vs. Wyoming.

The problem with this map is that you are **missing polarization from big cities in rural areas.** So other people use this idea with a higher resolution, using **counties instead of States**. The map on the right substitute purple for grey for counties where the difference is insignificant.

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-03.jpg "text-width")

Another problem with all those maps is that the **population is not evenly distributed through the territory. **Large states like Wyoming, where most people voted for Trump, look huge on the map but only represent 193K votes for Trump. **This gif went viral, trying to address** that problem.

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-04.gif "text-width")

At the same time, I still find **that map misleading** because counties, where the vote is quite divided between the suburbs and cities, tend to become vast blue balls. I prefer [this other map from The Economist](https://www.economist.com/graphic-detail/2020/11/03/the-us-2020-election-results) scaling vote **by population density**, which I think is closer visually to the actual result (50.9% of votes for Biden, 47.3% for Trump)

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-05.jpg "text-width")

This map also visualizes **much clearer,** in States like Ohio, the **rural-urban polarization**. Only major cities like Cincinnati or Cleveland vote Democrat. Sparser areas and the suburbs go Republican.

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-06.jpg "text-width")

### **Measuring and reducing Social Segregation in cities**

If we want to live in a less polarized society, we need to design cities, so we live in communities less segregated. **Schools are one of the most segregated places in the US**. What if they would become more like Science Museums and Theme Parks where rich and poor kids share similar experiences? Read [***Facts Don't Change Our Minds***](https://jamesclear.com/why-facts-dont-change-minds)[. ](https://jamesclear.com/why-facts-dont-change-minds)[***Friendship Does***](https://jamesclear.com/why-facts-dont-change-minds)***.***

> Economic inequality in the US is today higher than it was in the 1970’s and by some metrics stands at levels not seen since the last Great Depression. A special form of segregation is that happening in our cities. We share the public places, our workplaces and our residential neighborhoods with people like us: same type of jobs, same education, similar economic status, and political opinions.

🔗 **Source**: [Esteban Moro Blog](http://estebanmoro.org/post/2019-02-02-behavioral-fundations-of-inequality/) & [Atlas of Inequality](https://inequality.media.mit.edu/) & [Segregated interactions in urban and online space](https://link.springer.com/content/pdf/10.1140/epjds/s13688-020-00238-7.pdf)

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-07.jpg "text-width")

### Predicting Votes with **Sociodemographic variables & **Machine Learning

> I created a prediction model with Graphext with poll data that accurately predicted 75% of the votes using only 10 sociodemographic variables. Only race, ethnicity, and gender alone are more predictive than the rural-urban variable.

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-08.jpg "text-width")

Here is another viral tweet visualizing other sociodemographic variables but in maps.

[Obi Does @obidoessI just feel like more people need to see this 2:14 PM ∙ Nov 6, 202062,114Likes19,985Retweets](https://twitter.com/obidoess/status/1324716702660177920)

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-09.jpg "text-width")

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-10.jpg "text-width")

Looking at race, gender, and education alone helps think about why some people will lean for Republicans or Democrats **but creating predicting models that combine all of them tells a much richer story**. I made this video explaining how to interpret these models with [Graphext](http://twitter.com/graphext). I have the intuition that **the other 25% could be predicted with psychometrics variables**. I believe the next generation of pollsters will try to measure them.

---

### 🕸 Measuring **the rise of partisanship and super-cooperators in the US House of Representatives**

> Despite short-term fluctuations, partisanship or non-cooperation in the US Congress has been increasing exponentially for over 60 years with no sign of abating or reversing. Yet, a group of representatives continues to cooperate across party lines despite growing partisanship.

**🔗 Source**: [**Plos One**](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0123507)

This paper, from 2015, that I love has a very original way to measure political polarization among politicians. They created these graphs where each node is a member of Congress. **Edges are drawn between members who agree above the Congress’ *threshold value* of votes**. The *threshold value* is the number of agreements where any pair exhibiting this number of agreements is equally likely to comprise of two members of the same party (e.g. D-D or R-R), or a cross-party pair (e.g. D-R).

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-11.jpg "text-width")

---

### 🇺🇳🇺🇸 Comparing polarization in the US vs. Rest of the World

> The US has the largest polarization in the number of people that support or not their government dealing with the coronavirus outbreak.

🔗 **Source**: [America is exceptional in the nature of its political divide](https://www.pewresearch.org/fact-tank/2020/11/13/america-is-exceptional-in-the-nature-of-its-political-divide/)

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-12.jpg "text-width")

> Countries with more access to the Internet show significantly less government approval

🔗 **Source**: [3G Internet and Confidence in Government](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3456747)

The disillusionment of voters in governments had electoral implications: the expansion of mobile broadband internet led to a decrease in the vote shares of incumbent parties and an increase in the vote shares of the anti-establishment populist opposition. The vote shares of the non-populist opposition were unaffected by the expansion of 3G networks.

![](/api/images/blog/2020/11/15/how-big-is-the-political-polarization-in-the-us-how-predictable-are-voters/image-13.jpg "text-width")

A hypothesis for this would be that as the internet penetration grows, **the government loses control over the media** and new parties have an opportunity to grow their own audience via social media and networks like Whatsapp. How much is this due to fake news vs. deeper scrutiny of the government work is another topic that we’ll discuss in another newsletter.
