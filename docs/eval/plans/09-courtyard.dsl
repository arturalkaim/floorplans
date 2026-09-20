plan "Courtyard house" walls 0.3/0.12

room sala "Living room" living rect 0,0 9x3
room cozinha "Kitchen" kitchen rect 0,3 3x3
room quarto "Bedroom" bedroom rect 6,3 3x3
room banho "Bathroom" bath rect 0,6 9x2.4
outdoor patio "Courtyard" rect 3,3 3x3

door sala.north w1 entrance
door sala>cozinha w0.9 swing:cozinha
door sala>quarto w0.8 swing:quarto
door cozinha>banho w0.7 swing:banho
door patio>sala w0.9 glazed swing:sala
window patio>cozinha w1.2 on:cozinha.east
window patio>quarto w1.2 on:quarto.west
window banho.south w0.6
