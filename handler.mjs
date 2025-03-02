import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);
const tableName = process.env.TABLE_NAME;
const GUPSHUP_URL = process.env.GUPSHUP_URL;
const API_KEY = process.env.API_KEY;
const GUPSHUP_SENDER = process.env.GUPSHUP_SENDER;
const GUPSHUP_APP_NAME = process.env.GUPSHUP_APP_NAME;

// 📌 Handler principal
export const notify = async (event) => {
  try {
    const { idResponsability } = JSON.parse(event.body);
    if (!idResponsability) throw new Error("idResponsability es requerido");

    const nextResponsible = await validatorNextResponsability(idResponsability);
    const data = { idResponsability, ...nextResponsible };

    // ⏳ Ejecutar actualización y envío en paralelo
    const [_, sendWappResponse] = await Promise.all([
      updateLastResponsible(idResponsability, nextResponsible.id),
      sendWapp(data),
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `WhatsApp enviado a ${nextResponsible.nombre}`,
        response: sendWappResponse,
      }),
    };
  } catch (error) {
    console.error("Error en notify:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: error.message || "Error inesperado",
      }),
    };
  }
};

// 📌 Obtener el siguiente responsable
const validatorNextResponsability = async (idResponsability) => {
  try {
    const params = {
      TableName: tableName,
      Key: { id: String(idResponsability) },
    };
    const data = await dynamoDB.send(new GetCommand(params));

    if (!data.Item)
      throw new Error(
        `No se encontró la responsabilidad con ID ${idResponsability}`
      );

    const { responsables, ultimoResponsable } = data.Item;
    if (!responsables || responsables.length === 0)
      throw new Error("No hay responsables asignados.");

    const lastIndex = responsables.findIndex((r) => r.id === ultimoResponsable);
    const nextIndex =
      lastIndex === -1 ? 0 : (lastIndex + 1) % responsables.length;
    return responsables[nextIndex];
  } catch (error) {
    console.error("Error en validatorNextResponsability:", error);
    throw error;
  }
};

// 📌 Actualiza el último responsable en la base de datos
const updateLastResponsible = async (idResponsability, nextResponsibleId) => {
  try {
    const params = {
      TableName: tableName,
      Key: { id: idResponsability },
      UpdateExpression: "SET ultimoResponsable = :nextResponsibleId",
      ExpressionAttributeValues: { ":nextResponsibleId": nextResponsibleId },
    };

    await dynamoDB.send(new UpdateCommand(params));
  } catch (error) {
    console.error("Error en updateLastResponsible:", error);
    throw error;
  }
};

// 📌 Envía mensaje de WhatsApp con manejo de errores
const sendWapp = async (data) => {
  try {
    const { nombre, telefono, idResponsability } = data;
    const mensaje = `Hola ${nombre}, te toca el ${idResponsability}`;

    const response = await fetch(GUPSHUP_URL, {
      method: "POST",
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "application/x-www-form-urlencoded",
        apikey: API_KEY,
      },
      body: new URLSearchParams({
        channel: "whatsapp",
        source: GUPSHUP_SENDER,
        destination: telefono, // 📌 Usar el teléfono dinámico en lugar de fijo
        message: JSON.stringify({ type: "text", text: mensaje }),
        "src.name": GUPSHUP_APP_NAME,
      }),
    });

    if (!response.ok) {
      throw new Error(`Error en Gupshup: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error en sendWapp:", error);
    throw new Error("Error al enviar el mensaje de WhatsApp");
  }
};
