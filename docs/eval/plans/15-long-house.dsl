plan "Long narrow house" walls 0.3/0.12

room entrada "Entrance" hall rect 0,0 3x3.2
room sala "Living room" living rect 3,0 4.5x3.2
room cozinha "Kitchen" kitchen rect 7.5,0 3.5x3.2
room banho "Bathroom" bath rect 11,0 2x3.2
room quarto "Bedroom" bedroom rect 13,0 4x3.2

door entrada.west w0.9 entrance
cased entrada>sala w1.4
cased sala>cozinha w1.4
door cozinha>banho w0.7 swing:banho
door banho>quarto w0.8 swing:quarto
window sala.south w2
window cozinha.north w1.6
window banho.south w0.6
window quarto.east w1.6
