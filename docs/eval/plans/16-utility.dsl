plan "House with a utility" walls 0.3/0.12

room sala "Living room" living rect 0,0 5.5x5
room cozinha "Kitchen" kitchen rect 5.5,0 4x3.2
room lavandaria "Utility" utility rect 5.5,3.2 4x1.8
outdoor quintal "Yard" rect 0,5 9.5x4

door sala.north w1 entrance
cased sala>cozinha w1.6
door cozinha>lavandaria w0.8 swing:lavandaria
door quintal>lavandaria id:porta_servico w0.8 swing:lavandaria
window sala.west w2
window cozinha.east w1.6
window lavandaria.east w0.8
