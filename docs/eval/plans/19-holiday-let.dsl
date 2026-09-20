plan "Holiday let" walls 0.3/0.12 north 30

room sala "Living room" living day rect 0,0 6x4.5
room q1 "Bedroom 1" bedroom night rect 6,0 3.5x2.6
room q2 "Bedroom 2" bedroom night rect 6,2.6 3.5x2.6
room banho "Bathroom" bath night rect 0,4.5 4x1.9
room cozinha "Kitchen" kitchen day rect 4,4.5 5.5x1.9
outdoor terraco "Terrace" covered rect 0,6.4 9.5x3

door sala.north w1 entrance
door terraco>cozinha w1.6 glazed swing:cozinha
door sala>q1 w0.8 swing:q1
door sala>q2 w0.8 swing:q2
door sala>banho w0.7 swing:banho
cased sala>cozinha w1.4
window sala.west w2
window q1.east w1.2
window q2.east w1.2
window banho.west w0.6

fixture shower in:terraco at 8.4,6.6 size 0.9x0.9 "Outdoor shower"
