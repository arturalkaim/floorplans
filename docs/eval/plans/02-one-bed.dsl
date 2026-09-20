plan "One-bedroom flat" walls 0.3/0.12

room hall "Hall" hall rect 0,0 2x7.5
room sala "Living and kitchen" living rect 2,0 5x4
room quarto "Bedroom" bedroom rect 2,4 5x2
room banho "Bathroom" bath rect 2,6 5x1.5

door hall.north w0.9 entrance
door hall>sala w0.9 swing:sala
door hall>quarto w0.8 swing:quarto
door hall>banho w0.7 swing:banho
window sala.east w1.8
window quarto.east w1.4
window banho.south w0.6
