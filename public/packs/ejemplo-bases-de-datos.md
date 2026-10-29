# Bases de datos — ejemplos

## ¿Qué forma normal elimina las dependencias parciales de la clave?
- [ ] 1FN
- [x] 2FN
- [ ] 3FN
- [ ] FNBC
> La 2FN exige que cada atributo no clave dependa de toda la clave, no de una parte.
dominio: Normalización
dificultad: media
concepto: Formas normales

## ¿Qué cuenta esta consulta en una tabla donde algunas filas tienen la edad a NULL?
```sql
SELECT COUNT(edad) FROM alumnos;
```
- [x] Solo las filas cuya edad no es NULL
- [ ] Todas las filas
- [ ] Solo las filas con edad NULL
- [ ] Error de sintaxis
> COUNT(columna) ignora los NULL; COUNT(*) cuenta todas las filas.
dominio: SQL
dificultad: difícil
concepto: Funciones de agregado
